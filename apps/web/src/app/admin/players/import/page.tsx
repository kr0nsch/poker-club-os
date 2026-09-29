"use client";

import { Alert, Badge, Button, cn, Field, PageHeader, Select, Stat, Table, TBody, Td, Th, THead, Tr } from "@pcos/ui";
import { PLAYER_IMPORT_FIELDS, type PlayerImportField } from "@pcos/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { IMPORT_FIELD_LABEL } from "@/components/admin-config/labels";
import { cfgKeys } from "@/components/admin-config/queries";
import type { ImportPreview, ImportReport, ImportUpload } from "@/components/admin-config/types";
import { BackLink, Section } from "@/components/admin-config/ui";
import { useCan } from "@/components/staff-guard";
import { post } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { errorMessage } from "@/lib/queries";

type Step = "upload" | "mapping" | "preview" | "done";
const MAX_BYTES = 10 * 1024 * 1024;

function readText(file: File, encoding: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file, encoding);
  });
}

export default function PlayerImportPage() {
  const t = useT();
  const fmt = useFormat();
  const can = useCan();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("utf-8");
  const [drag, setDrag] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportUpload | null>(null);
  const [mapping, setMapping] = useState<Record<string, PlayerImportField | "">>({});
  const [strategy, setStrategy] = useState<"SKIP" | "UPDATE">("SKIP");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("Choose a CSV file"));
      const content = await readText(file, encoding);
      return post<ImportUpload>("/api/v1/imports/players", { filename: file.name.slice(0, 200), content });
    },
    onSuccess: (res) => {
      setJob(res);
      setMapping(Object.fromEntries(res.headers.map((h) => [h, res.suggestedMapping[h] ?? ""])));
      setStep("mapping");
    },
  });

  const validate = useMutation({
    mutationFn: async () => {
      const m = Object.fromEntries(Object.entries(mapping).filter(([, f]) => f)) as Record<string, string>;
      await post(`/api/v1/imports/${job!.id}/mapping`, { mapping: m, duplicateStrategy: strategy });
      return post<ImportPreview>(`/api/v1/imports/${job!.id}/validate`);
    },
    onSuccess: (res) => {
      setPreview(res);
      setStep("preview");
    },
  });

  const apply = useMutation({
    mutationFn: () => post<ImportReport>(`/api/v1/imports/${job!.id}/apply`),
    onSuccess: (res) => {
      setReport(res);
      setStep("done");
      void qc.invalidateQueries({ queryKey: cfgKeys.players });
      void qc.invalidateQueries({ queryKey: cfgKeys.playerTags });
    },
  });

  function pick(f: File | null | undefined) {
    setReadError(null);
    upload.reset();
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setReadError(t("The file is larger than 10 MB."));
      return;
    }
    setFile(f);
  }

  function restart() {
    setStep("upload");
    setFile(null);
    setJob(null);
    setPreview(null);
    setReport(null);
    upload.reset();
    validate.reset();
    apply.reset();
  }

  const mapped = Object.values(mapping).filter(Boolean) as PlayerImportField[];
  const duplicatesInMapping = mapped.filter((f, i) => mapped.indexOf(f) !== i);
  const missingRequired = (["firstName", "lastName"] as const).filter((f) => !mapped.includes(f));
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: t("Upload") },
    { key: "mapping", label: t("Map columns") },
    { key: "preview", label: t("Review") },
    { key: "done", label: t("Done") },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  if (!can("player.import")) {
    return (
      <div>
        <BackLink href="/admin/players" label={t("Players")} />
        <Alert variant="warning">{t("You do not have permission to import players.")}</Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink href="/admin/players" label={t("Players")} />
      <PageHeader title={t("Import players from CSV")} description={t("Upload a file, map its columns, check the result, then import.")} />
      <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={cn("flex size-6 items-center justify-center rounded-full border text-xs", i < stepIndex ? "border-primary bg-primary text-primary-foreground" : i === stepIndex ? "border-primary text-primary" : "border-border text-muted-foreground")}>{i + 1}</span>
            <span className={i === stepIndex ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
            {i < steps.length - 1 && <span className="text-muted-foreground">›</span>}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <Section title={t("Choose a file")} description={t("CSV with a header row, up to 10 MB. First and last name are required; email, phone and member number are used to find duplicates.")}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors", drag ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40")}
          >
            <FileUp className="size-8 text-muted-foreground" />
            {file ? (
              <>
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">{t("{size} KB — click to choose another file", { size: fmt.number(Math.ceil(file.size / 1024)) })}</span>
              </>
            ) : (
              <>
                <span className="font-medium">{t("Drop a CSV file here or click to choose")}</span>
                <span className="text-xs text-muted-foreground">{t("Exported from a spreadsheet or another club system")}</span>
              </>
            )}
          </button>
          <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Field label={t("File encoding")} hint={t("Choose Windows-1251 if Cyrillic names look garbled (older Excel exports).")} className="max-w-sm">
            <Select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
              <option value="utf-8">UTF-8</option>
              <option value="windows-1251">Windows-1251</option>
              <option value="windows-1252">Windows-1252</option>
            </Select>
          </Field>
          {(readError || upload.isError) && <Alert variant="destructive">{readError ?? errorMessage(upload.error)}</Alert>}
          <div className="flex justify-end">
            <Button disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
              <Upload /> {t("Upload and continue")}
            </Button>
          </div>
        </Section>
      )}

      {step === "mapping" && job && (
        <Section title={t("Map columns")} description={t("{rows} rows in {file}. Columns set to “Ignore” are not imported.", { rows: fmt.number(job.rowCount), file: file?.name ?? "" })}>
          <Table>
            <THead>
              <Tr>
                <Th>{t("CSV column")}</Th>
                <Th className="hidden md:table-cell">{t("Sample values")}</Th>
                <Th>{t("Import as")}</Th>
              </Tr>
            </THead>
            <TBody>
              {job.headers.map((h) => {
                const value = mapping[h] ?? "";
                const dup = !!value && duplicatesInMapping.includes(value);
                return (
                  <Tr key={h}>
                    <Td className="font-medium">{h || <span className="text-muted-foreground">{t("(no name)")}</span>}</Td>
                    <Td className="hidden max-w-72 md:table-cell">
                      <div className="truncate text-xs text-muted-foreground">
                        {job.sample
                          .map((r) => r[h])
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(" · ") || "—"}
                      </div>
                    </Td>
                    <Td>
                      <Select className={cn("h-9 py-1", dup && "border-destructive")} value={value} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as PlayerImportField | "" }))} aria-label={t("Import as")}>
                        <option value="">{t("— Ignore —")}</option>
                        {PLAYER_IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {t(IMPORT_FIELD_LABEL[f])}
                            {f === "firstName" || f === "lastName" ? " *" : ""}
                          </option>
                        ))}
                      </Select>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          {missingRequired.length > 0 && <Alert variant="warning">{t("Map columns to: {fields}", { fields: missingRequired.map((f) => t(IMPORT_FIELD_LABEL[f])).join(", ") })}</Alert>}
          {duplicatesInMapping.length > 0 && <Alert variant="destructive">{t("Each field can be used only once: {fields}", { fields: [...new Set(duplicatesInMapping)].map((f) => t(IMPORT_FIELD_LABEL[f])).join(", ") })}</Alert>}
          <Field label={t("Players that already exist (same member number, email or phone)")}>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["SKIP", "UPDATE"] as const).map((s) => (
                <label key={s} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm", strategy === s ? "border-primary bg-primary/5" : "border-border")}>
                  <input type="radio" name="strategy" className="mt-0.5 accent-[var(--primary)]" checked={strategy === s} onChange={() => setStrategy(s)} />
                  <span>
                    <span className="font-medium">{s === "SKIP" ? t("Skip them") : t("Update them")}</span>
                    <span className="block text-xs text-muted-foreground">{s === "SKIP" ? t("Existing players stay unchanged.") : t("Filled-in values from the file overwrite existing data.")}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          {validate.isError && <Alert variant="destructive">{errorMessage(validate.error)}</Alert>}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={restart}>
              {t("Choose another file")}
            </Button>
            <Button disabled={missingRequired.length > 0 || duplicatesInMapping.length > 0} loading={validate.isPending} onClick={() => validate.mutate()}>
              {t("Check the data")}
            </Button>
          </div>
        </Section>
      )}

      {step === "preview" && preview && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Rows")} value={fmt.number(preview.total)} hint={t("{n} valid", { n: fmt.number(preview.valid) })} />
            <Stat label={t("New players")} value={<span className="text-success">{fmt.number(preview.willCreate)}</span>} />
            <Stat label={t("Updated")} value={fmt.number(preview.willUpdate)} />
            <Stat label={t("Skipped / invalid")} value={`${fmt.number(preview.willSkip)} / ${fmt.number(preview.total - preview.valid)}`} />
          </div>
          {preview.invalid.length > 0 && (
            <Section title={t("Rows with errors ({n})", { n: preview.total - preview.valid })} description={t("These rows are not imported. Fix them in the file and import it again if needed.")}>
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-20">{t("Row")}</Th>
                      <Th>{t("Problems")}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {preview.invalid.map((r) => (
                      <Tr key={r.row}>
                        <Td className="tabular-nums">{r.row}</Td>
                        <Td className="text-sm text-destructive">{r.errors.join("; ")}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Section>
          )}
          {preview.duplicates.length > 0 && (
            <Section title={t("Duplicates ({n})", { n: preview.duplicates.length })} description={strategy === "UPDATE" ? t("Existing players are updated; duplicates inside the file are skipped.") : t("These rows are skipped.")}>
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-20">{t("Row")}</Th>
                      <Th>{t("Name")}</Th>
                      <Th>{t("Matches")}</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {preview.duplicates.map((d) => (
                      <Tr key={d.row}>
                        <Td className="tabular-nums">{d.row}</Td>
                        <Td>{d.name.trim() || "—"}</Td>
                        <Td className="text-sm">
                          {d.inFileDuplicateOf ? (
                            t("Same as row {row} of the file", { row: d.inFileDuplicateOf })
                          ) : d.duplicateOf ? (
                            <Link href={`/admin/players/${d.duplicateOf.playerId}`} target="_blank" className="text-primary hover:underline">
                              {t("Existing player (same {field})", { field: t(IMPORT_FIELD_LABEL[d.duplicateOf.field as PlayerImportField] ?? d.duplicateOf.field).toLowerCase() })}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Section>
          )}
          {(preview.sampleNew ?? preview.sample ?? []).length > 0 && (
            <Section title={t("New players (sample)")}>
              <Table>
                <THead>
                  <Tr>
                    <Th>{t("Name")}</Th>
                    <Th className="hidden sm:table-cell">{t("Email")}</Th>
                    <Th className="hidden sm:table-cell">{t("Phone")}</Th>
                    <Th>{t("Member number")}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {(preview.sampleNew ?? preview.sample ?? []).map((r, i) => (
                    <Tr key={i}>
                      <Td>
                        {String(r.firstName ?? "")} {String(r.lastName ?? "")}
                        {r.nickname ? <span className="text-muted-foreground"> · {String(r.nickname)}</span> : null}
                      </Td>
                      <Td className="hidden sm:table-cell">{String(r.email ?? "—")}</Td>
                      <Td className="hidden sm:table-cell">{String(r.phone ?? "—")}</Td>
                      <Td className="font-mono">{String(r.memberNumber ?? "—")}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Section>
          )}
          {apply.isError && <Alert variant="destructive">{errorMessage(apply.error)}</Alert>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("mapping")}>
              {t("Back to mapping")}
            </Button>
            <Button disabled={preview.willCreate + preview.willUpdate === 0 || !can("player.create")} loading={apply.isPending} onClick={() => apply.mutate()}>
              {t("Import {n} players", { n: fmt.number(preview.willCreate + preview.willUpdate) })}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && report && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" /> {t("Import finished")}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label={t("Created")} value={<span className="text-success">{fmt.number(report.created)}</span>} />
            <Stat label={t("Updated")} value={fmt.number(report.updated)} />
            <Stat label={t("Skipped")} value={fmt.number(report.skipped)} />
            <Stat label={t("Invalid")} value={fmt.number(report.invalid)} />
            <Stat label={t("Duplicates")} value={fmt.number(report.duplicates)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/admin/players">{t("Go to players")}</Link>
            </Button>
            <Button variant="outline" onClick={restart}>
              {t("Import another file")}
            </Button>
            {report.created > 0 && <Badge variant="success" className="self-center">{t("Imported players have the source “Import”")}</Badge>}
          </div>
        </Section>
      )}
    </div>
  );
}
