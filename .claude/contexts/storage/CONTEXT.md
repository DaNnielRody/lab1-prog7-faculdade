# Storage

Binary persistence for audio bytes, behind an interface so the local disk implementation can be
swapped for S3/Azure Blob without touching endpoints. Source: a `Stream` of audio bytes → sink:
a file on disk + a resolvable download URL.

Files:
- `src/AudioApi/Storage/IFileStore.cs` — contract, `StoredFile`, `FileContent`, `DeleteAsync`.
- `src/AudioApi/Storage/LocalFileStore.cs` — disk implementation (registered as a singleton).
- `src/AudioApi/Options/StorageOptions.cs`.

## Language

**File store**:
The binary sink for audio content. Addressed by **stored file name**, not by path — callers
never build paths.
_Avoid_: bucket, blob store, disk

**Stored file name**:
`{id:N}{extension}` — the audio's `Guid` with no dashes plus an extension. An audio's stored file
name **changes once** in its life: it is the *original* extension while `ProcessingStatus` is
`Pending`/`Processing`, and `.m4a` from `Completed` onwards.
_Avoid_: path, filename, key

**The `.m4a` collision**:
Because the name is `{id:N}{extension}`, an upload that is *already* `.m4a` resolves to the same
stored file name before and after compression: `SaveAsync` overwrites in place. Deleting the
"original" afterwards would delete the compressed output and leave a `Completed` row pointing at
nothing. Every delete of a replaced original must therefore be guarded by an **ordinal** old-vs-new
name comparison. Covered by
`Processing_M4aUpload_KeepsTheCompressedFileDespiteTheStoredNameCollision`.
_Avoid_: overwrite bug, dedupe

**Resolvable URL**:
`{baseUrl}/api/audios/{id}/download` — points at the API's own download endpoint, never at a
filesystem path. Built by `LocalFileStore.SaveAsync` from the `baseUrl` the endpoint passes in.
_Avoid_: public URL, file URL

## Relationships

- One **AudioFile** row ↔ one **stored file**, joined by **stored file name**.
- `OpenReadAsync` returns `null` (not an exception) when the row exists but the file is gone →
  the API turns that into 404.
- `OpenReadAsync` hardens against traversal with `Path.GetFileName(storedFileName)`; `DeleteAsync`
  does the same, and is a **no-op on a missing file** so a cleanup can never fail a job. Keep both.
- **Compression** (`AudioProcessingBackgroundService`) re-reads the original through
  `OpenReadAsync`, writes the `.m4a` with `SaveAsync`, and deletes the original with `DeleteAsync`
  only after the row is committed.
- **Summarization** re-reads bytes through `OpenReadAsync` — the store now has *three* consumers
  (request, compression worker, summary worker), so it must stay free of request-scoped state
  (it is a singleton).

## Flagged ambiguities

- **This invariant was deliberately reversed in week 4.** It used to read: "the store persists
  only the compressed file; original bytes are never stored anywhere." Now the store holds the
  **original** from upload until compression completes, then only the `.m4a`. The reason is that
  compression moved off the request thread (`docs/week4-threading-pipeline.md`), so the bytes have
  to survive between the response and the worker; holding 50 MB per queued upload in memory
  instead is the memory blow-up the bounded queue exists to prevent. **At most one file per audio
  at rest** — the original is deleted as soon as the `.m4a` row is committed. Reintroducing a
  permanent second copy still needs an ADR.
- `IFileStore.SaveAsync` still takes a `baseUrl`, which is a request-shaped parameter now that a
  background worker also calls it; the worker reconstructs it from the row's stored `Url`
  (`AudioProcessingBackgroundService.BaseUrlOf`). It works because the URL is id-based, but it
  breaks silently if the download route changes shape. Moving URL construction into the API layer
  is the clean fix, deferred.
- `filestore/` and `data/` are gitignored runtime dirs, created on startup.
