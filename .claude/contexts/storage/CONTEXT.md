# Storage

Binary persistence for audio bytes, behind an interface so the local disk implementation can be
swapped for S3/Azure Blob without touching endpoints. Source: a `Stream` of already-compressed
audio → sink: a file on disk + a resolvable download URL.

Files:
- `src/AudioApi/Storage/IFileStore.cs` — contract, `StoredFile`, `FileContent`.
- `src/AudioApi/Storage/LocalFileStore.cs` — disk implementation (registered as a singleton).
- `src/AudioApi/Options/StorageOptions.cs`.

## Language

**File store**:
The binary sink for audio content. Addressed by **stored file name**, not by path — callers
never build paths.
_Avoid_: bucket, blob store, disk

**Stored file name**:
`{id:N}{extension}` — the audio's `Guid` with no dashes plus the extension produced by
compression (always `.m4a` today). This is the only key the store accepts.
_Avoid_: path, filename, key

**Resolvable URL**:
`{baseUrl}/api/audios/{id}/download` — points at the API's own download endpoint, never at a
filesystem path. Built by `LocalFileStore.SaveAsync` from the `baseUrl` the endpoint passes in.
_Avoid_: public URL, file URL

## Relationships

- One **AudioFile** row ↔ one **stored file**, joined by **stored file name**.
- `OpenReadAsync` returns `null` (not an exception) when the row exists but the file is gone →
  the API turns that into 404.
- `OpenReadAsync` hardens against traversal with `Path.GetFileName(storedFileName)`; keep that.
- **Summarization** re-reads bytes through `OpenReadAsync` — it is the *second* consumer of the
  store, so the store must stay free of request-scoped state (it is a singleton).

## Flagged ambiguities

- The store persists **only the compressed** file. Original bytes are never stored anywhere —
  do not add an "original" copy without an ADR.
- `filestore/` and `data/` are gitignored runtime dirs, created on startup.
