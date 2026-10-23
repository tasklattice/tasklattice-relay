// Host-only worker: deliberately starts no Kubernetes maintenance jobs.
import { startWorkWorker } from "./work-worker";
import { prisma } from "../db/prisma";
const stop = startWorkWorker();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stop();
    void prisma()
      .$disconnect()
      .then(() => process.exit(0));
  });
console.log("Work worker ready. Queue and leases are persisted in PostgreSQL.");
