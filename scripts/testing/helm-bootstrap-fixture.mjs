// Offline configuration checks use the same generator/serializer as the Job.
// These synthetic Secrets are never applied to a cluster.
import { generateCredentials, renderOutput } from "../credential-bootstrap/bootstrap-secrets.mjs";

export function materializeBootstrapSecrets(objects, transform = data => data) {
  const template = objects.find(object => object?.kind === "ConfigMap" && object.data?.["spec.json"]);
  if (!template) return objects;
  const spec = JSON.parse(template.data["spec.json"]);
  const credentials = transform(generateCredentials(spec));
  return [...objects, ...spec.outputs.map(output => ({
    apiVersion: "v1", kind: "Secret", metadata: { name: output.name, namespace: spec.namespace },
    stringData: renderOutput(output, credentials),
  }))];
}
