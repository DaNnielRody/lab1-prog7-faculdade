"use client";

import { useEffect, useRef, useState } from "react";

import { CompletedDialog } from "@/components/transcription/CompletedDialog";
import { ConfirmRestartDialog } from "@/components/transcription/ConfirmRestartDialog";
import { FailedDialog } from "@/components/transcription/FailedDialog";
import { PlayerBar } from "@/components/transcription/PlayerBar";
import { SettingsPanel } from "@/components/transcription/SettingsPanel";
import { Sidebar } from "@/components/transcription/Sidebar";
import { Thread } from "@/components/transcription/Thread";
import { Topbar } from "@/components/transcription/Topbar";
import { UploadDialog } from "@/components/transcription/UploadDialog";
import { useTranscription } from "@/lib/useTranscription";

/**
 * The transcription screen — docs/DESIGN.md §4: a three-column shell of
 * {layout.rail} 240px · {layout.center} fluid · {layout.panel} 320px.
 *
 * `useTranscription()` owns the session state; every composite below is a pure function of props.
 * The only state this file adds is dialog visibility, which is presentation, not session state.
 */
export default function TranscriptionScreen() {
  const session = useTranscription();
  const { phase, error, file, summary } = session;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);

  // The outcome dialogs announce a transition, so they open once per arrival at a terminal phase.
  const announcedPhase = useRef(phase);
  useEffect(() => {
    if (announcedPhase.current === phase) return;
    announcedPhase.current = phase;
    if (phase === "completed") setCompletedOpen(true);
    if (phase === "failed") setFailedOpen(true);
  }, [phase]);

  /** The panel CTA is phase-driven: send, retry, or clear the screen for the next audio. */
  function handleSubmit() {
    if (phase === "idle") {
      if (file) setUploadOpen(true);
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
      {/*
        Below {bp.laptop} the rail collapses. docs/DESIGN.md §9 specifies a hamburger menu for it
        and a drawer/bottom sheet for the panel; §11 records that only the desktop frame is drawn,
        so those surfaces are not invented here — the panel simply stacks under the thread.
      */}
      <Sidebar className="hidden xl:flex" />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar phase={phase} onRestart={() => setRestartOpen(true)} />

        {/* Chat body — {spacing.8} vertical, 40px horizontal (docs/DESIGN.md §4). */}
        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
          <Thread
            phase={phase}
            progress={session.progress}
            file={file}
            audio={session.audio}
            summary={summary}
            error={error}
            messages={session.messages}
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
      />
      <CompletedDialog
        open={completedOpen}
        summary={summary}
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
    </div>
  );
}
