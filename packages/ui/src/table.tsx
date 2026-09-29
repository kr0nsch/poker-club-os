import * as React from "react";
import { cn } from "./cn.js";

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    // @container (inline-size containment) keeps a wide table from widening its grid or flex parent:
    // the wrapper takes the width it is given and the table scrolls inside it.
    <div className="@container edge-light relative w-full overflow-x-auto rounded-xl border border-white/[0.06] bg-card">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-white/[0.06] [&_tr]:bg-white/[0.015] [&_tr]:hover:bg-white/[0.015]", className)} {...props} />;
}
export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-white/[0.045] transition-colors hover:bg-white/[0.025]", className)} {...props} />;
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-10 px-4 text-left align-middle text-xs font-medium text-muted-foreground", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
