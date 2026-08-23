"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CompletedDialog } from "@/components/transcription/CompletedDialog";
import { ConfirmRestartDialog } from "@/components/transcription/ConfirmRestartDialog";
import { FailedDialog } from "@/components/transcription/FailedDialog";
import { PlayerBar } from "@/components/transcription/PlayerBar";
import { SettingsPanel } from "@/components/transcription/SettingsPanel";
import { Sidebar } from "@/components/transcription/Sidebar";
import { Thread } from "@/components/transcription/Thread";
import { Topbar } from "@/components/transcription/Topbar";
import { UploadDialog } from "@/components/transcription/UploadDialog";
import { Toast, type ToastNotice } from "@/components/ui/Toast";
import { useProcessedAudios } from "@/lib/useProcessedAudios";
import { useTranscription } from "@/lib/useTranscription";

/** How many already-processed audios the conversation opens with, newest kept. */
const HISTORY_LIMIT = 10;

export default function TranscriptionScreen() {
  const session = useTranscription();
  const { phase, error, file, summary, audio } = session;
  const processed = useProcessedAudios(phase, session.audio);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);

  const announcedPhase = useRef(phase);
  useEffect(() => {
    if (announcedPhase.current === phase) return;
    announcedPhase.current = phase;
    if (phase === "completed") setCompletedOpen(true);
    if (phase === "failed") setFailedOpen(true);
  }, [phase]);

  // The API lists newest first; a conversation reads oldest first. The audio of the session
  // currently on screen is dropped so it is not told twice — once as history, once live.
  //
  // Only the most recent few: `GET /api/audios` is unpaginated, and the whole history rendered
  // on open means scrolling past every old audio to reach the session you just started. There is
  // no "ver mais" control because none is designed — the cut is silent and deliberate.
  const history = useMemo(
    () =>
      processed.audios
        .filter((item) => item.id !== session.audio?.id)
        .slice(0, HISTORY_LIMIT)
        .reverse(),
    [processed.audios, session.audio?.id],
  );

  const [notice, setNotice] = useState<ToastNotice | null>(null);
  const dialogOpen = uploadOpen || completedOpen || failedOpen || restartOpen;

  // The toast is screen-level, not list-level: it belongs to the composition, not to the
  // component whose fetch failed. An accepted upload is omitted from `history` because its live
  // session already renders below; the toast remains reserved for errors with no history rows.
  const listUnreachable = processed.error !== null && history.length === 0;
  const { errorSeq, reload } = processed;
  useEffect(() => {
    if (!listUnreachable) {
      setNotice(null);
      return;
    }
    setNotice({
      id: errorSeq,
      message: "Não foi possível carregar os áudios processados.",
      actionLabel: "Recarregar a lista",
      onAction: reload,
    });
  }, [listUnreachable, errorSeq, reload]);

  function handleSubmit() {
    if (phase === "idle") {
      if (file && session.canUpload) setUploadOpen(true);
      return;
    }
    if (phase === "failed") {
      setFailedOpen(false);
      void session.retry();
      return;
    }
    if (phase === "completed" || phase === "disabled") {
      setCompletedOpen(false);
      session.reset();
    }
  }

  function handleConfirmUpload() {
    if (!session.canUpload) return;
    setUploadOpen(false);
    void session.start();
  }

  function handleRestart() {
    setRestartOpen(false);
    setCompletedOpen(false);
    setFailedOpen(false);
    session.reset();
  }

  return (
    <div className="flex min-h-screen w-full flex-col xl:h-screen xl:flex-row xl:overflow-hidden">
      {/* The processed-list fetch is the client's most reliable reachability probe: it runs on
          mount and on every poll, and it fails only on transport, never on a domain outcome. */}
      <Sidebar apiReachable={processed.error === null} className="hidden xl:flex" />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar phase={phase} onRestart={() => setRestartOpen(true)} />
        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
          <Thread
            phase={phase}
            progress={session.progress}
            file={file}
            audio={session.audio}
            summary={summary}
            error={error}
            messages={session.messages}
            processed={history}
            onRetry={() => {
              setFailedOpen(false);
              void session.retry();
            }}
            onSendAnother={() => {
              setFailedOpen(false);
              session.reset();
            }}
          />
        </div>
        <PlayerBar file={file} />
      </main>
      <SettingsPanel
        phase={phase}
        file={file}
        validation={session.validation}
        onSelectFile={session.selectFile}
        onClearFile={session.clearFile}
        onSubmit={handleSubmit}
        className="w-full xl:w-panel"
      />
      <UploadDialog
        open={uploadOpen}
        file={file}
        onClose={() => setUploadOpen(false)}
        onConfirm={handleConfirmUpload}
        canConfirm={session.canUpload}
      />
      <CompletedDialog
        open={completedOpen}
        summary={summary}
        audio={audio}
        onClose={() => setCompletedOpen(false)}
      />
      <FailedDialog
        open={failedOpen}
        error={error}
        onClose={() => setFailedOpen(false)}
        onRetry={() => {
          setFailedOpen(false);
          void session.retry();
        }}
      />
      <ConfirmRestartDialog
        open={restartOpen}
        onCancel={() => setRestartOpen(false)}
        onConfirm={handleRestart}
      />
      {/* Last child of the root: tab order reaches the toast after all page content. */}
      <Toast notice={notice} paused={dialogOpen} onDismiss={() => setNotice(null)} />
    </div>
  );
}
