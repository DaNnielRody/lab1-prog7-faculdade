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

export default function TranscriptionScreen() {
  const session = useTranscription();
  const { phase, error, file, summary, audio } = session;

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
      <Sidebar className="hidden xl:flex" />
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
    </div>
  );
}
