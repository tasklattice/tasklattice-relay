import {
  answerArtifactSchema,
  type AnswerArtifact,
  type AnswerJsonValue,
} from "@tali/contracts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function findAnswerArtifact(value: unknown): AnswerArtifact | null {
  const queue: unknown[] = [value];
  const visited = new Set<object>();
  for (let index = 0; index < queue.length && index < 300; index += 1) {
    const current = queue[index];
    const parsed = answerArtifactSchema.safeParse(current);
    if (parsed.success) return parsed.data;
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
    } else {
      const record = current as Record<string, unknown>;
      if ("answer" in record) queue.unshift(record.answer);
      queue.push(...Object.values(record));
    }
  }
  return null;
}

function renderValue(value: AnswerJsonValue) {
  return typeof value === "string"
    ? <p className="whitespace-pre-wrap text-sm leading-6">{value}</p>
    : <pre className="overflow-auto whitespace-pre-wrap text-xs leading-5">{JSON.stringify(value, null, 2)}</pre>;
}

export function AnswerArtifactRenderer({ value }: { value: unknown }) {
  const artifact = findAnswerArtifact(value);
  if (!artifact) return null;
  if (artifact.kind === "ANSWER_PATCH") {
    return (
      <section className="border bg-background" aria-label="Answer Patch">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
          <div>
            <p className="text-sm font-semibold">Answer Patch</p>
            <p className="mt-1 text-xs text-muted-foreground">Document {artifact.documentId} · base revision {artifact.baseRevision}</p>
          </div>
          <Badge variant="outline">{artifact.operations.length} operations</Badge>
        </header>
        <div className="divide-y">
          {artifact.operations.map((operation, index) => (
            <div className="p-4" key={`${operation.op}:${index}`}>
              <p className="font-mono text-xs font-medium">{operation.op}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {operation.op === "SET_STATE"
                  ? operation.path
                  : operation.op === "REMOVE_BLOCK"
                    ? operation.blockId
                    : operation.block.id}
              </p>
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="border bg-background" aria-label="Answer Document">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <p className="text-sm font-semibold">Structured answer</p>
          <p className="mt-1 text-xs text-muted-foreground">Stable blocks · revision {artifact.revision}</p>
        </div>
        <Badge variant={artifact.status === "ANSWER" ? "default" : "outline"}>{artifact.status}</Badge>
      </header>
      <div className="divide-y">
        {artifact.blocks.map((block) => {
          const updated = block.metadata.updated === true || block.metadata.recomputed === true;
          return (
            <article
              className={cn("p-4", updated && "border-l-2 border-l-primary bg-primary/5")}
              data-answer-block-id={block.id}
              key={block.id}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">{block.type}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{block.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  {updated ? <Badge>Updated</Badge> : null}
                  <span className="font-mono text-[10px] text-muted-foreground">r{block.revision}</span>
                </div>
              </div>
              {renderValue(block.value)}
              {block.provenance.length ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                  {block.provenance.map((source, index) => (
                    <Badge key={`${source.kind}:${source.sourceId}:${index}`} variant="outline">
                      {source.kind.replaceAll("_", " ")} · {source.sourceId}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
