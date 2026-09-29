"use client";

import { cn, Skeleton } from "@pcos/ui";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** QR code rendered locally (no network): black on white for reliable scanning. */
export function QrCode({ value, size = 200, className, label }: { value: string; size?: number; className?: string; label?: string }) {
  const [img, setImg] = useState<{ value: string; src: string } | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: Math.max(320, size * 2), errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((src) => {
        if (alive) setImg({ value, src });
      })
      .catch(() => {
        if (alive) setImg(null);
      });
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!img || img.value !== value) return <Skeleton className={cn("shrink-0 rounded-lg", className)} style={{ width: size, height: size }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URL generated on the device
    <img src={img.src} alt={label ?? value} width={size} height={size} className={cn("shrink-0 rounded-lg bg-white p-1.5", className)} style={{ imageRendering: "pixelated" }} />
  );
}
