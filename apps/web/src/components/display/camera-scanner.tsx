"use client";

import { Button } from "@pcos/ui";
import { CameraOff, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

// The Barcode Detection API is not in TypeScript's DOM library yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

/** Camera QR scanning works only where BarcodeDetector exists (Chromium on Android/ChromeOS/macOS). */
export function cameraScanSupported(): boolean {
  return !!detectorCtor() && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export function CameraScanner({ onCode, onCancel }: { onCode: (value: string) => void; onCancel: () => void }) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const emit = useEffectEvent((value: string) => onCode(value));

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const Ctor = detectorCtor();
    const run = async () => {
      if (!Ctor) throw new Error("BarcodeDetector unavailable");
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
      const video = videoRef.current;
      if (stopped || !video) return;
      video.srcObject = stream;
      await video.play();
      const detector = new Ctor({ formats: ["qr_code"] });
      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            const raw = (await detector.detect(video))[0]?.rawValue;
            if (raw && !stopped) {
              stopped = true;
              emit(raw);
              return;
            }
          }
        } catch {
          /* frame not ready yet */
        }
        timer = setTimeout(() => void tick(), 200);
      };
      void tick();
    };
    run().catch(() => {
      if (!stopped) setFailed(true);
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border-2 border-primary/50 bg-black">
      {failed ? (
        <div className="grid aspect-video place-items-center gap-3 p-6 text-center text-white/80">
          <CameraOff className="size-12" />
          <p className="text-xl">{t("The camera is not available. Please use the scanner or another option.")}</p>
        </div>
      ) : (
        <>
          <video ref={videoRef} className="aspect-video w-full -scale-x-100 object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="aspect-square h-[70%] rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        </>
      )}
      <Button variant="secondary" size="lg" className="absolute right-3 top-3" onClick={onCancel}>
        <X /> {t("Close camera")}
      </Button>
    </div>
  );
}
