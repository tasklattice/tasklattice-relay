import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { DoclingClient } from "./docling-client";

const doclingUrl = process.env.TALI_DOCLING_INTEGRATION_URL;
const databaseUrl = process.env.TALI_VECTOR_DATABASE_INTEGRATION_URL;
const liveDescribe = doclingUrl && databaseUrl ? describe : describe.skip;

function embeddingFor(value: string, marker: string): number[] {
  return value.includes(marker) ? [1, 0, 0, 0] : [0, 1, 0, 0];
}

liveDescribe("Docling and PostgreSQL Vector Database live integration", () => {
  it("chunks a document, embeds its chunks, stores them in pgvector, and retrieves the marker", async () => {
    const marker = `tali-vector-${randomUUID()}`;
    const parser = new DoclingClient(doclingUrl);
    const target = await parser.parse({
      bytes: new TextEncoder().encode(`# Operations\n\nThe recovery marker is ${marker}.`),
      filename: "operations.md",
      mediaType: "text/markdown",
    });
    const decoy = await parser.parse({
      bytes: new TextEncoder().encode("# Handbook\n\nRotate credentials every ninety days."),
      filename: "handbook.md",
      mediaType: "text/markdown",
    });

    expect(target.chunks.some((chunk) => chunk.content.includes(marker))).toBe(true);
    expect(target.processingTimeSeconds).toBeGreaterThanOrEqual(0);

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`
        CREATE TEMP TABLE docling_vector_integration_chunks (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding vector(4) NOT NULL
        )
      `);
      const documents = [
        { filename: "operations.md", chunks: target.chunks },
        { filename: "handbook.md", chunks: decoy.chunks },
      ];
      for (const document of documents) {
        for (const chunk of document.chunks) {
          const vector = `[${embeddingFor(chunk.content, marker).join(",")}]`;
          await client.query(
            `INSERT INTO docling_vector_integration_chunks (id, filename, content, embedding)
             VALUES ($1, $2, $3, $4::vector)`,
            [`${document.filename}-${chunk.index}`, document.filename, chunk.content, vector],
          );
        }
      }
      const queryVector = `[${embeddingFor(marker, marker).join(",")}]`;
      const result = await client.query<{ filename: string; content: string; score: number }>(
        `SELECT filename, content, 1 - (embedding <=> $1::vector) AS score
         FROM docling_vector_integration_chunks
         ORDER BY embedding <=> $1::vector
         LIMIT 1`,
        [queryVector],
      );
      expect(result.rows[0]).toMatchObject({ filename: "operations.md" });
      expect(result.rows[0]?.content).toContain(marker);
      expect(Number(result.rows[0]?.score)).toBeGreaterThan(0.99);
    } finally {
      client.release();
      await pool.end();
    }
  }, 10 * 60 * 1_000);
});
