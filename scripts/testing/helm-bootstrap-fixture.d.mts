interface Manifest {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  data?: Record<string, string>;
  stringData?: Record<string, string>;
}

export function materializeBootstrapSecrets(
  objects: Manifest[],
  transform?: (credentials: Record<string, string>) => Record<string, string>,
): Manifest[];
