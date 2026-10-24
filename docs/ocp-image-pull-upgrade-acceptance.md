# OCP 共享 ImageStream：部署、升级、验收与回退

本手册针对本次 Chart 和配套 Control/Worker 镜像（包含租户 SCC reconcile）：Gateway/certgen、Supervisor、默认 Sandbox、OpenClaw/Hermes/DeepAgents、Runtime Bridge 和 Expert Runtime 统一复用**控制面 namespace** 的 ImageStream。使用包含修复的 Control/Worker 镜像；它必须内置更新后的 `/opt/tali/helm/openshell.tgz`。

命令使用 **Bash**，从仓库根目录、同一个 shell 按顺序执行。需要 `oc`、Helm 3、`jq`、`curl`、Node.js 22+、`skopeo` 及仓库 npm 依赖。已 `oc login`，操作账号可管理本次 namespace/RBAC；冷拉取节点检查需 `oc debug node` 权限。下列为操作手册，未在真实 OCP 执行。

原地升级仅支持已采用 [初始化 Job 凭据](helm-credential-bootstrap.md) 的部署；旧明文凭据部署需另行迁移。先完成数据库备份和版本兼容检查。Argo CD 管理的部署使用相同 values 更新 Git 并 sync，不要同时运行 Helm upgrade/rollback；下面的发布和回退命令针对 Helm 管理的部署。

## 1. 设置参数并保存升级基线

只需替换这一段环境参数。`SITE_VALUES` 是本环境已有的完整 values：首次部署包含域名、SCC、存储与静态组件镜像配置；升级则使用现有配置。下文不会用默认 values 覆盖升级配置，也不会把控制面静态镜像自动切到内部 registry。`CONTROL_IMAGE_REPOSITORY` 必须是已发布修复镜像的可拉取源，且不带 tag/digest。

```bash
set -euo pipefail
umask 077
export MODE='upgrade'                         # 首次部署改为 install
export CONTROL_NS='tali'
export IMAGE_SOURCE_NS="$CONTROL_NS"
export RELEASE='tali-relay'
export REGISTRY='image-registry.openshift-image-registry.svc:5000'
export FIXED_CHART='/absolute/path/tali-relay-fixed.tgz'
export SITE_VALUES='/absolute/path/site-values.yaml'
export CONTROL_IMAGE_REPOSITORY='your-registry.example/team/tali-control'
export CONTROL_TAG='<包含修复的不可变版本>'
export RELAY_VERSION='<首次部署的 Relay 镜像版本>' # upgrade 时忽略，不使用 dev/latest
export BASE_URL='https://relay.example.com'    # 不带末尾 /
export OLD_PROJECT_ID='<已有健康 Project ID>' # install 时设为空字符串
export DEPARTMENT_ID='<允许新建验收 Project 的 Department ID>'
export RUN_ID="$(date -u +%Y%m%d%H%M%S)"
# 证据目录可能包含部署值、cookie 和回退文件，放在仓库外，不上传。
export EVIDENCE="$HOME/relay-ocp-acceptance-$RUN_ID"
mkdir -p "$EVIDENCE"
[[ "$MODE" == install || "$MODE" == upgrade ]]
[[ "$IMAGE_SOURCE_NS" == "$CONTROL_NS" ]]
oc whoami
oc version
helm version --short
# 未安装仓库依赖时先执行 npm ci；离线环境提前准备 node_modules。
node -e 'require("yaml"); require("smol-toml")'

project_ns() {
  oc get ns -o json | jq -er --arg id "$1" \
    '[.items[] | select(.metadata.annotations["tali.io/project-id"]==$id)] |
     if length==1 then .[0].metadata.name else error("未找到唯一 Project Namespace") end'
}
snapshot_sa() {
  oc -n "$1" get sa -o json | jq -S '[.items[] | {name:.metadata.name,uid:.metadata.uid}] | sort_by(.name)'
}
OLD_NS=''
if [[ "$MODE" == upgrade ]]; then
  oc get namespace "$CONTROL_NS"
  helm status "$RELEASE" -n "$CONTROL_NS" -o json > "$EVIDENCE/status.before.json"
  jq -e '.info.status=="deployed"' "$EVIDENCE/status.before.json" >/dev/null
  PREV_REV=$(jq -er .version "$EVIDENCE/status.before.json")
  printf '%s\n' "$PREV_REV" > "$EVIDENCE/control-revision.before.txt"
  helm history "$RELEASE" -n "$CONTROL_NS" -o json > "$EVIDENCE/history.before.json"
  helm get values "$RELEASE" -n "$CONTROL_NS" --all -o json > "$EVIDENCE/values.before.json"
  PREV_APP_VERSION=$(helm list -n "$CONTROL_NS" -o json | jq -er --arg r "$RELEASE" \
    '.[] | select(.name==$r) | .app_version | select(length>0)')
  # 显式固定旧版本，避免空 tag 随新 Chart appVersion 变化。
  jq --arg v "$PREV_APP_VERSION" \
    '.images |= with_entries(if (.value.tag // "") == "" then .value.tag=$v else . end)' \
    "$EVIDENCE/values.before.json" > "$EVIDENCE/values.base.json"
  # 自动生成凭据根 Secret 的公开归属标识；只保存摘要，不保存 Secret 数据。
  CREDENTIAL_SECRET=$(jq -r '.credentialBootstrap.existingSecret // ""' "$EVIDENCE/values.before.json")
  if [[ -z "$CREDENTIAL_SECRET" ]]; then
  CREDENTIAL_SECRET=$(oc -n "$CONTROL_NS" get secrets -l "app.kubernetes.io/instance=$RELEASE" -o json | \
    jq -er '[.items[] | select(.data.initialPlatformAdministratorPassword and .data.authSecret)] |
      if length==1 then .[0].metadata.name else error("请从现有部署确认唯一凭据根 Secret") end')
  fi
  oc -n "$CONTROL_NS" get secret "$CREDENTIAL_SECRET" -o json | jq -cS .data | shasum -a 256 \
    > "$EVIDENCE/credentials.before.sha256"
  BASE_ARGS=(-f "$EVIDENCE/values.base.json")
  OLD_NS=$(project_ns "$OLD_PROJECT_ID")
  snapshot_sa "$OLD_NS" > "$EVIDENCE/old-sa.before.json"
  oc -n "$OLD_NS" get pods -o json | jq '[.items[] | {
    name:.metadata.name,sa:.spec.serviceAccountName,scc:.metadata.annotations["openshift.io/scc"],
    images:[.spec.initContainers[]?.image,.spec.containers[].image]}]' > "$EVIDENCE/old-pods.before.json"
else
  oc create namespace "$CONTROL_NS" --dry-run=client -o yaml | oc apply -f -
  # 仅新部署使用 OCP profile；升级不要用它覆盖已有安全/网络设置。
  helm show values "$FIXED_CHART" > "$EVIDENCE/chart-defaults.yaml"
  jq -n --arg v "$RELAY_VERSION" '{images:{control:{tag:$v},runner:{tag:$v},
    expertAgentRuntime:{tag:$v},openclawSandbox:{tag:$v},hermesSandbox:{tag:$v},
    deepagentsSandbox:{tag:$v},exampleMcp:{tag:$v}}}' > "$EVIDENCE/values.versions.json"
  BASE_ARGS=(-f charts/tali-relay/values-openshift.yaml -f "$SITE_VALUES" -f "$EVIDENCE/values.versions.json")
fi
# 保存已有租户 release 修订号及状态。回退后以 Worker reconcile 收敛，保留历史供诊断。
oc get ns -l tali.io/runtime-target=true -o json | jq -r --arg ns "$CONTROL_NS" --arg r "$RELEASE" \
  '.items[] | select(.metadata.annotations["tali.io/control-namespace"]==$ns and
    .metadata.annotations["tali.io/control-release"]==$r) | .metadata.name' > "$EVIDENCE/tenants.before.txt"
while IFS= read -r ns; do
  helm list -n "$ns" -o json > "$EVIDENCE/$ns-releases.before.json"
done < "$EVIDENCE/tenants.before.txt"
```

统一模式要求 Chart 管理 Worker/Runner 配置；若已有 `secrets.existingSecrets.worker` 或 `.runner`，先迁移配置管理方式，或保持 `runtimeImages.enabled=false` 手工同步两端。本手册在渲染阶段会拒绝半自动迁移。

## 2. 生成实际镜像导入清单

先渲染“原始源地址”和“统一内部地址”两份清单，由只读工具解析 Worker/Runner 的真实配置。自定义镜像名、tag 和 digest 均保留，不手写八套默认值。渲染文件可能包含其他组件的环境配置，仍留在受限证据目录内。

Control 镜像使用内部 registry 时，新 Chart 自动准备 bootstrap SA、OCP 拉取 Secret 引用及源 namespace 的 `system:image-puller` 绑定。OCP 4.16+ 的控制器负责生成凭据，无需手工预建 SA；执行 Helm 的身份仍需具备源 namespace 的授权权限。`credentialBootstrap.serviceAccountName` 留空使用自动模式；已有显式覆盖继续按原配置使用。

```bash
jq -n --arg ns "$IMAGE_SOURCE_NS" --arg host "$REGISTRY" \
  --arg repo "$CONTROL_IMAGE_REPOSITORY" --arg tag "$CONTROL_TAG" '{
    openshift:{enabled:true,imageSourceNamespace:$ns,imageRegistryHost:$host,
      runtimeImages:{enabled:true},imagePullReadyTimeoutMs:120000},
    images:{control:{repository:$repo,tag:$tag,useGlobalRegistry:false}}
  }' > "$EVIDENCE/values.shared.json"
helm template "$RELEASE" "$FIXED_CHART" -n "$CONTROL_NS" --kube-version 1.29.0 \
  "${BASE_ARGS[@]}" -f "$EVIDENCE/values.shared.json" \
  --set openshift.runtimeImages.enabled=false > "$EVIDENCE/source.yaml"
helm template "$RELEASE" "$FIXED_CHART" -n "$CONTROL_NS" --kube-version 1.29.0 \
  "${BASE_ARGS[@]}" -f "$EVIDENCE/values.shared.json" > "$EVIDENCE/target.yaml"
node scripts/ocp-runtime-image-plan.mjs "$EVIDENCE/source.yaml" "$EVIDENCE/target.yaml" \
  > "$EVIDENCE/image-plan.json"
jq -r '.images[] | [(.roles|join(",")),.source,.target,(.stream+":"+.tag),(.digest//"-")] | @tsv' \
  "$EVIDENCE/image-plan.json"
```

核对每行源地址确实可访问。默认 Gateway/ Supervisor 的 ImageStream 名为 `gateway`/`supervisor`；若原 repository 使用 `openshell-gateway`，则保留该名称。digest-only 镜像使用 `relay-sha256-<hash>` 作为导入标签，Runtime 仍按原 digest 拉取。清单包含禁用的 Expert Runtime，以便后续启用；实际启动验收只覆盖启用组件。

### 2.1 在线导入 ImageStream（与离线复制二选一）

源私有仓库需提前在控制面 namespace 配置可供 OCP 镜像导入/Registry pull-through 使用的仓库凭据。`oc import-image` 成功只证明元数据导入成功，镜像层首次读取仍可能访问上游；因此后面必须做实际拉取。`PreserveOriginal` 保留多架构 manifest，`Local` 使引用走内部 registry。[Red Hat ImageStream 文档](https://docs.redhat.com/en/documentation/openshift_container_platform/4.14/html/images/managing-image-streams)。

```bash
# 不覆盖已存在的发布标签。存在则只读取，后续 digest 检查不符时停止。
jq -r '.images[] | [.source,.stream,.tag] | @tsv' "$EVIDENCE/image-plan.json" > "$EVIDENCE/import.tsv"
while IFS=$'\t' read -r source stream tag; do
  if oc -n "$IMAGE_SOURCE_NS" get istag "$stream:$tag" --ignore-not-found -o name | jq -Rse 'length>0' >/dev/null; then
    printf '保留已有 ImageStreamTag: %s:%s\n' "$stream" "$tag"
  else
    [[ "$source" != "$REGISTRY/$IMAGE_SOURCE_NS/"* ]] || {
      echo "源指向尚不存在的自身 ImageStream，请在原 values 中提供可导入的上游：$source" >&2; false;
    }
    oc -n "$IMAGE_SOURCE_NS" import-image "$stream:$tag" --from="$source" \
      --confirm --import-mode=PreserveOriginal --reference-policy=local
  fi
 done < "$EVIDENCE/import.tsv"
```

### 2.2 离线部署：复制镜像层到内部 Registry

完全离线时从已准备好的内网镜像仓库复制，不能依赖外部源的 pull-through。`PUSH_REGISTRY` 使用运维端可访问、已配置有效证书的内部 Registry route；它与 Pod 使用的 `REGISTRY` 可以不同，但必须属于同一个 OCP Registry。当前登录用户需有该 namespace 的镜像推送权限。`--all --preserve-digests` 保留多架构和 digest；失败时不要删掉这两个选项绕过。[Skopeo copy 参数](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md)。

```bash
export PUSH_REGISTRY='<本集群内部 Registry 的外部 route 主机名>'
export AUTH_FILE="$EVIDENCE/registry-auth.json"
printf '{"auths":{}}\n' > "$AUTH_FILE"
oc whoami -t | skopeo login --authfile "$AUTH_FILE" --username "$(oc whoami)" --password-stdin "$PUSH_REGISTRY"
# 私有内网源需要另登录，交互输入凭据；源地址由 SITE_VALUES/原部署 values 指定。
# skopeo login --authfile "$AUTH_FILE" your-mirror.example
jq -r '.images[] | [.source,.stream,.tag] | @tsv' "$EVIDENCE/image-plan.json" > "$EVIDENCE/import.tsv"
while IFS=$'\t' read -r source stream tag; do
  source_access="$source"
  [[ "$source" != "$REGISTRY/"* ]] || source_access="$PUSH_REGISTRY/${source#"$REGISTRY/"}"
  source_digest="sha256:$(skopeo inspect --raw --authfile "$AUTH_FILE" "docker://$source_access" | shasum -a 256 | awk '{print $1}')"
  existing=$(oc -n "$IMAGE_SOURCE_NS" get istag "$stream:$tag" --ignore-not-found -o json)
  if [[ -n "$existing" ]]; then
    [[ "$(jq -er .image.metadata.name <<< "$existing")" == "$source_digest" ]] || {
      echo "拒绝覆盖不同内容的已有 tag：$stream:$tag；请发布新 tag" >&2; false;
    }
  fi
  oc -n "$IMAGE_SOURCE_NS" create imagestream "$stream" --dry-run=client -o yaml | oc apply -f -
  skopeo copy --all --preserve-digests --authfile "$AUTH_FILE" \
    "docker://$source_access" "docker://$PUSH_REGISTRY/$IMAGE_SOURCE_NS/$stream:$tag"
done < "$EVIDENCE/import.tsv"
```

### 2.3 检查导入结果并保存 digest 基线

digest 引用必须与导入结果完全一致。离线验收需确保节点和 Registry 无法访问外部上游后执行冷拉取，以排除已有 ImageStream 的 pull-through 回源；复制命令成功不能替代这项验收。只有 tag 的源也会通过 Skopeo 读取上游 manifest 并比较 digest；源需从运维机可访问。私有源先 `skopeo login`，或设置 `AUTH_FILE` 指向现有认证文件。上游为内部 service DNS 时，设置 `PUSH_REGISTRY` 为同集群可访问 route。下面保存本次实际 digest，后续发现同名 tag 变化就停止验收。若已有 tag 指向错误版本，先发布新版本 tag 并重新渲染计划，不覆盖旧 tag，以便回退。

```bash
: > "$EVIDENCE/imported.ndjson"
while IFS= read -r item; do
  stream=$(jq -r .stream <<< "$item"); tag=$(jq -r .tag <<< "$item")
  expected=$(jq -r '.digest//""' <<< "$item")
  image=$(oc -n "$IMAGE_SOURCE_NS" get istag "$stream:$tag" -o json)
  actual=$(jq -er '.image.metadata.name | select(startswith("sha256:"))' <<< "$image")
  if [[ -z "$expected" ]]; then
    source=$(jq -r .source <<< "$item")
    if [[ "$source" == "$REGISTRY/"* && -n "${PUSH_REGISTRY:-}" ]]; then
      source="$PUSH_REGISTRY/${source#"$REGISTRY/"}"
    fi
    auth_args=()
    [[ -z "${AUTH_FILE:-}" ]] || auth_args=(--authfile "$AUTH_FILE")
    expected="sha256:$(skopeo inspect --raw "${auth_args[@]}" "docker://$source" | shasum -a 256 | awk '{print $1}')"
  fi
  [[ "$expected" == "$actual" ]] || {
    echo "digest 不匹配：$stream:$tag 期望 $expected 实际 $actual" >&2; false;
  }
  jq -nc --argjson item "$item" --arg digest "$actual" '$item+{importedDigest:$digest}' >> "$EVIDENCE/imported.ndjson"
done < <(jq -c '.images[]' "$EVIDENCE/image-plan.json")
jq -s . "$EVIDENCE/imported.ndjson" > "$EVIDENCE/imported.json"
jq -r '.[]|[(.stream+":"+.tag),.importedDigest]|@tsv' "$EVIDENCE/imported.json"
```

## 3. 执行部署或升级

先确认静态组件所需的其他镜像、SCC、存储、registry 凭据已由 `SITE_VALUES`/原部署准备好。统一模式只重写租户 Runtime 镜像，不改变控制面 Pod、依赖组件和 bootstrap Job 的镜像路径。原有显式 `imagePullSecrets` 保留，这些 Secret 必须在实际消费它们的 namespace 存在。

```bash
if [[ "$MODE" == upgrade ]]; then
  helm upgrade "$RELEASE" "$FIXED_CHART" -n "$CONTROL_NS" \
    "${BASE_ARGS[@]}" -f "$EVIDENCE/values.shared.json" \
    --atomic --wait --wait-for-jobs --timeout 30m
else
  # 首装失败保留资源和失败 Job 以便排查；不要为重试删除 PVC/凭据 Secret。
  helm install "$RELEASE" "$FIXED_CHART" -n "$CONTROL_NS" \
    "${BASE_ARGS[@]}" -f "$EVIDENCE/values.shared.json" \
    --wait --wait-for-jobs --timeout 30m
fi
component_deploy() {
  oc -n "$CONTROL_NS" get deploy -l "app.kubernetes.io/instance=$RELEASE,app.kubernetes.io/component=$1" \
    -o json | jq -er '.items | if length==1 then .[0].metadata.name else error("Deployment 数量不为 1") end'
}
CONTROL_DEPLOY=$(component_deploy control)
WORKER_DEPLOY=$(component_deploy control-worker)
RUNNER_DEPLOY=$(component_deploy runner)
WORKER_SA=$(oc -n "$CONTROL_NS" get deploy "$WORKER_DEPLOY" -o jsonpath='{.spec.template.spec.serviceAccountName}')
for deployment in "$CONTROL_DEPLOY" "$WORKER_DEPLOY" "$RUNNER_DEPLOY"; do
  oc -n "$CONTROL_NS" rollout status "deploy/$deployment" --timeout=10m
done
helm status "$RELEASE" -n "$CONTROL_NS"
if [[ "$MODE" == upgrade ]]; then
  oc -n "$CONTROL_NS" get secret "$CREDENTIAL_SECRET" -o json | jq -cS .data | shasum -a 256 > "$EVIDENCE/credentials.after.sha256"
  diff -u "$EVIDENCE/credentials.before.sha256" "$EVIDENCE/credentials.after.sha256"
fi
oc -n "$CONTROL_NS" exec "deploy/$WORKER_DEPLOY" -c control-worker -- \
  tar -xOf /opt/tali/helm/openshell.tgz openshell/templates/certgen.yaml > "$EVIDENCE/certgen-template.txt"
grep -F 'pkiInitJob.serviceAccount' "$EVIDENCE/certgen-template.txt"
```

初始化凭据不会因切换镜像源轮换。部署失败时跳到第 9 节保存现场并回退；不要继续创建租户。升级成功只表示控制面就绪，Worker 管理的租户 release 还需下面逐一验收。

## 4. 读取实际运行配置、验证 Worker 权限

从正在运行的 Worker 读取允许公开的配置字段，后续命令使用实际 release 名、SA 前缀和镜像，避免假定所有部署都使用默认值。不会导出完整配置或 Secret 内容。

```bash
oc -n "$CONTROL_NS" exec "deploy/$WORKER_DEPLOY" -c control-worker -- node -e '
const fs=require("node:fs");
const c=require("smol-toml").parse(fs.readFileSync(process.env.TALI_WORKER_CONFIG,"utf8")).worker;
const g=c.project_openshell;
const cases=[
  {role:"certgen",image:`${g.gatewayImageRepository}:${g.gatewayImageTag}`,secrets:g.imagePullSecrets||[]},
  {role:"gateway",image:`${g.gatewayImageRepository}:${g.gatewayImageTag}`,secrets:g.imagePullSecrets||[]},
  {role:"sandbox",image:g.sandboxImage,secrets:g.sandboxImagePullSecrets||[]},
  {role:"supervisor",image:`${g.supervisorImageRepository}:${g.supervisorImageTag}`,secrets:g.sandboxImagePullSecrets||[]},
  ...(g.sandboxImages||[]).map((image,i)=>({role:`platform-${i}`,image,secrets:g.sandboxImagePullSecrets||[]})),
  ...[c.project_runtime_bridge,c.expert_agent_runtime].filter(x=>x?.enabled).map((x,i)=>({role:`runtime-${i}`,image:x.image,secrets:x.imagePullSecrets||[]}))
];
process.stdout.write(JSON.stringify({openshift:c.openshift,release:g.releaseName,prefix:g.serviceNamePrefix,cases},null,2));
' > "$EVIDENCE/worker-images.json"
jq . "$EVIDENCE/worker-images.json"
jq -e --arg ns "$IMAGE_SOURCE_NS" \
  '.openshift.enabled==true and .openshift.imageSourceNamespace==$ns' "$EVIDENCE/worker-images.json"
TENANT_RELEASE=$(jq -er .release "$EVIDENCE/worker-images.json")
SA_PREFIX=$(jq -er .prefix "$EVIDENCE/worker-images.json")

oc -n "$CONTROL_NS" exec "deploy/$RUNNER_DEPLOY" -c runner -- node -e '
const fs=require("node:fs");
const c=JSON.parse(fs.readFileSync(process.env.TALI_RUNNER_CONFIG,"utf8"));
process.stdout.write(JSON.stringify(c.openshell.sandbox.images));
' > "$EVIDENCE/runner-images.json"
jq -e -n --slurpfile worker "$EVIDENCE/worker-images.json" --slurpfile runner "$EVIDENCE/runner-images.json" \
  '([$worker[0].cases[]|select(.role|startswith("platform-"))|.image]|sort)==($runner[0]|[.[]]|sort)'
jq -e --arg prefix "$REGISTRY/$IMAGE_SOURCE_NS/" \
  'all(.cases[]; .image|startswith($prefix))' "$EVIDENCE/worker-images.json"

# --as 不会自动补齐 SA 的所有组；必须包含 Namespace SA 组。
sa_can() {
  local ns="$1" sa="$2"; shift 2
  oc auth can-i "$@" --as="system:serviceaccount:$ns:$sa" \
    --as-group=system:authenticated --as-group=system:serviceaccounts \
    --as-group="system:serviceaccounts:$ns"
}
expect_can() {
  local expected="$1" result; shift
  result=$(sa_can "$@" || true)
  [[ "$result" == "$expected" ]] || { echo "权限不符：期望 $expected，实际 $result；$*" >&2; return 1; }
}
for verb in get create patch; do
  expect_can yes "$CONTROL_NS" "$WORKER_SA" "$verb" rolebindings.rbac.authorization.k8s.io -n "$IMAGE_SOURCE_NS"
done
expect_can yes "$CONTROL_NS" "$WORKER_SA" bind clusterroles.rbac.authorization.k8s.io/system:image-puller -n "$IMAGE_SOURCE_NS"
expect_can no "$CONTROL_NS" "$WORKER_SA" bind clusterroles.rbac.authorization.k8s.io/cluster-admin -n "$IMAGE_SOURCE_NS"
expect_can no "$CONTROL_NS" "$WORKER_SA" bind clusterroles.rbac.authorization.k8s.io/system:image-puller -n kube-system
expect_can yes "$CONTROL_NS" "$WORKER_SA" get serviceaccounts -n "${OLD_NS:-$CONTROL_NS}"
expect_can yes "$CONTROL_NS" "$WORKER_SA" create serviceaccounts -n "${OLD_NS:-$CONTROL_NS}"
expect_can yes "$CONTROL_NS" "$WORKER_SA" get secrets -n "${OLD_NS:-$CONTROL_NS}"
```

以上负向检查若返回 `yes`，排查环境里额外的 ClusterRoleBinding；不要把越权结果当作本次修复通过。跨项目拉取的授权对象是源 Namespace 的 `imagestreams/layers`，不是只测 `get imagestreams`。[Red Hat 跨项目镜像访问说明](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/images/managing-images)。

## 5. 登录 Relay，验收已有租户和新建租户

示例使用已启用的用户名登录；SSO-only 环境使用你自己的有效 Netscape cookie 文件替换 `COOKIE_JAR`，跳过用户名登录段。不要为测试启用开发登录或使用默认密码。

```bash
COOKIE_JAR="$EVIDENCE/relay.cookies"
read -rp 'Relay username: ' LOGIN_USER
read -rsp 'Relay password: ' LOGIN_PASSWORD; printf '\n'
printf '%s' "$LOGIN_PASSWORD" | jq -Rs --arg username "$LOGIN_USER" \
  '{username:$username,password:.,rememberMe:false}' \
  | curl --fail-with-body --silent --show-error --connect-timeout 10 --max-time 60 \
      -c "$COOKIE_JAR" -H "Origin: $BASE_URL" -H 'Content-Type: application/json' \
      --data-binary @- "$BASE_URL/api/auth/sign-in/username" > /dev/null
unset LOGIN_PASSWORD

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(--fail-with-body --silent --show-error --connect-timeout 10 --max-time 120
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H "Origin: $BASE_URL" -H 'Content-Type: application/json' -X "$method")
  [[ -z "$body" ]] || args+=(--data-binary "$body")
  curl "${args[@]}" "$BASE_URL$path"
}
select_project() {
  api PUT /api/v1/access-context "$(jq -nc --arg id "$1" \
    '{level:"project",resourceId:$id,roleId:"ROLE_PROJECT_ADMIN"}')" > /dev/null
}
wait_project() {
  local id="$1" result state
  for ((i=0;i<240;i++)); do
    result=$(api GET "/api/v1/projects/$id/initialization")
    printf '%s\n' "$result" > "$EVIDENCE/$id-initialization.json"
    state=$(jq -r .status <<< "$result")
    if jq -e '.status=="ready" and .observedGeneration>=.generation' <<< "$result" >/dev/null; then
      jq . <<< "$result"; return 0
    fi
    if [[ "$state" == failed || "$state" == deleting ]]; then jq . <<< "$result"; return 1; fi
    sleep 10
  done
  echo "初始化等待超时：$id" >&2; return 1
}

# install 没有旧租户时跳过这一项，不记作“已有租户升级通过”。
if [[ -n "$OLD_NS" ]]; then
# 已有租户：不用等待周期巡检；显式触发一次，等待 generation 完成。
select_project "$OLD_PROJECT_ID"
api POST "/api/v1/projects/$OLD_PROJECT_ID/initialization/reconcile" '{}' | jq .
wait_project "$OLD_PROJECT_ID"
snapshot_sa "$OLD_NS" > "$EVIDENCE/old-sa.after.json"
jq -e -n --slurpfile before "$EVIDENCE/old-sa.before.json" --slurpfile after "$EVIDENCE/old-sa.after.json" \
  'all($before[0][]; . as $b | any($after[0][]; .name==$b.name and .uid==$b.uid))'

fi

# 新建租户：由 Relay 创建，不手工 oc create namespace / RoleBinding 代替。
api GET /api/v1/departments | jq .
api PUT /api/v1/access-context "$(jq -nc --arg id "$DEPARTMENT_ID" \
  '{level:"department",resourceId:$id,roleId:"ROLE_DEPARTMENT_ADMIN"}')" > /dev/null
api POST /api/v1/projects "$(jq -nc --arg id "$DEPARTMENT_ID" --arg name "ocp-pull-$RUN_ID" \
  '{departmentId:$id,name:$name,invitations:[]}')" > "$EVIDENCE/new-project.json"
NEW_PROJECT_ID=$(jq -er .id "$EVIDENCE/new-project.json")
select_project "$NEW_PROJECT_ID"
wait_project "$NEW_PROJECT_ID"
NEW_NS=$(project_ns "$NEW_PROJECT_ID")
TENANT_NAMES=("$NEW_NS")
[[ -z "$OLD_NS" ]] || TENANT_NAMES+=("$OLD_NS")
printf '已有租户：%s\n新建租户：%s\n' "$OLD_NS" "$NEW_NS"

# 再次 reconcile 新租户，验证幂等及 certgen SA 不再被 hook 重建。
snapshot_sa "$NEW_NS" > "$EVIDENCE/new-sa.before-retry.json"
api POST "/api/v1/projects/$NEW_PROJECT_ID/initialization/reconcile" '{}' | jq .
wait_project "$NEW_PROJECT_ID"
snapshot_sa "$NEW_NS" > "$EVIDENCE/new-sa.after-retry.json"
diff -u "$EVIDENCE/new-sa.before-retry.json" "$EVIDENCE/new-sa.after-retry.json"
```

HTTP 409 表示已有运行操作持有 lease，等该操作结束再触发，不循环强行重置。失败租户同样调用 reconcile，完成后应为 `ready`；不能只观察 Namespace 已创建。新建 Project 会消耗租户配额，需要在有验收容量的 Department 执行。

### 5.1 在已有/新租户实际创建 Agent

Gateway Ready 不代表平台 Sandbox 已经启动过。为两个租户各准备一个可用的模型路由和 ACTIVE Access Policy（新租户在 Relay UI 配置或复用获授权的模型配置），然后执行下面命令。缺少路由/策略时会停止，不能把这项标为通过。这里仅创建 Hermes Runtime，不发起模型对话或 embedding；其他平台如需启动验收可按同样流程替换 `agentPlatform`。

```bash
PROJECT_IDS=("$NEW_PROJECT_ID")
[[ -z "$OLD_NS" ]] || PROJECT_IDS+=("$OLD_PROJECT_ID")
items_filter='if type=="array" then . else (.items // .data // []) end'
for project in "${PROJECT_IDS[@]}"; do
  select_project "$project"
  routing=$(api GET "/api/v1/projects/$project/model-routings" | jq -er "$items_filter | [.[]|select(.status==\"READY\")][0].id // error(\"先配置 READY 模型路由\")")
  policy=$(api GET "/api/v1/projects/$project/access-policies" | jq -er "$items_filter | [.[]|select(.status==\"ACTIVE\")][0].id // error(\"先配置 ACTIVE 策略\")")
  api POST "/api/v1/projects/$project/instances" "$(jq -nc --arg name "ocp-runtime-$RUN_ID" --arg route "$routing" --arg policy "$policy" '{
    name:$name,runtime:"openshell",agentPlatform:"hermes",modelRoutingId:$route,accessPolicyIds:[$policy],
    knowledgeSourceIds:[],memory:{mode:"native"},systemPrompt:"Deployment acceptance; wait for user instructions."
  }')" > "$EVIDENCE/$project-instance-created.json"
  instance=$(jq -er .instanceId "$EVIDENCE/$project-instance-created.json")
  ready=false
  for ((i=0;i<120;i++)); do
    api GET "/api/v1/projects/$project/instances/$instance" > "$EVIDENCE/$project-instance.json"
    state=$(jq -r '(.instance // .).status' "$EVIDENCE/$project-instance.json")
    if [[ "$state" == READY ]]; then ready=true; break; fi
    if [[ "$state" == FAILED ]]; then jq . "$EVIDENCE/$project-instance.json"; break; fi
    sleep 5
  done
  [[ "$ready" == true ]] || { echo "Runtime 未就绪：$project/$instance" >&2; false; }
  ns=$(project_ns "$project")
  oc -n "$ns" get pods -o json | jq --arg image "$(jq -r .hermes "$EVIDENCE/runner-images.json")" \
    '[.items[]|select(any(.spec.containers[]; .image==$image))|{
      name:.metadata.name,sa:.spec.serviceAccountName,
      initImages:[.spec.initContainers[]?.image],images:[.spec.containers[].image],
      statuses:[.status.initContainerStatuses[]?,.status.containerStatuses[]?]}]' \
    > "$EVIDENCE/$project-hermes-pods.json"
  jq -e 'length>0 and all(.[]; any(.statuses[]; .ready==true))' "$EVIDENCE/$project-hermes-pods.json"
done
```

记录实际 Sandbox 与 Supervisor init container 的 image/imageID，并与计划比对。此项验证实例部署与就绪；真实对话/工具调用属于另外的业务验收，不能由冷拉取探针替代。

## 6. 两类租户的 RoleBinding、SA、SCC 与工作负载

`openshift.enabled=true` 时，新增 `openshift.manageTenantScc` 默认 true（旧 values 缺失时也为 true）。Control Chart 授予 Worker 对 `system:openshift:scc:privileged` 和 `system:openshift:scc:anyuid` 的限定 bind 权限；新 Worker 在租户 Namespace 初始化时，先补 ImageStream 拉取授权，再补 SCC 绑定，最后执行 Gateway Helm/certgen 和 Runtime Bridge。

升级必须同时更新 Control Chart 和包含新 Worker 的共享 Control 镜像；只更新 Chart 不会执行租户 SCC reconcile。已有 ready 租户会在周期性 reconcile（默认约 5 分钟）补齐，新租户在首次初始化时准备。SCC 授权失败记录为 retry，不会继续启动 Gateway；已经进入终止重试的 failed 状态需在平台发起初始化重试。补建不替换 SA、Secret、Pod 或 PVC。这里专指 SCC reconcile 的行为，配套 Helm/业务升级仍按其正常滚动更新策略执行。

默认 SA 映射：Sandbox SA → privileged；Gateway/certgen SA → anyuid；Bridge/Expert 目前使用 default SA → anyuid。授权绑定由 Namespace 持有，不归属租户 Helm release；恢复未完成的 Gateway release 不会移除它们。与其他租户、控制面及镜像源 Namespace 的 SCC 授权互不混用。

平台自管 SCC 时显式设置 `openshift.manageTenantScc=false`，并跳过下面自动绑定的断言。关闭开关、回滚或卸载控制面不会主动撤销已经生效的租户 SCC 绑定，以免现有 Sandbox 无法重启；需要收回权限时由平台在确认工作负载后清理。自动模式不会接管同名的外部绑定。

```bash
for ns in "${TENANT_NAMES[@]}"; do
  uid=$(oc get ns "$ns" -o jsonpath='{.metadata.uid}')
  binding="tali-image-puller-$ns-$uid"
  oc -n "$IMAGE_SOURCE_NS" get rolebinding "$binding" -o json \
    > "$EVIDENCE/$ns-puller-binding.json"
  jq -e --arg ns "$ns" --arg uid "$uid" '
    .roleRef.kind=="ClusterRole" and .roleRef.name=="system:image-puller" and
    any(.subjects[]; .kind=="Group" and .name==("system:serviceaccounts:"+$ns)) and
    any(.metadata.ownerReferences[]; .kind=="Namespace" and .name==$ns and .uid==$uid)
  ' "$EVIDENCE/$ns-puller-binding.json"

  gateway="$SA_PREFIX$ns"
  sandbox=$(printf '%s' "$gateway-sandbox" | cut -c1-63 | sed 's/-$//')
  # 自动 SCC 管理模式：检查实际绑定和 SCC use 权限，不读取凭据。
  for scc in privileged anyuid; do
    oc -n "$ns" get rolebinding "tali-project-scc-$scc" -o json \
      > "$EVIDENCE/$ns-scc-$scc.json"
    jq -e --arg ns "$ns" --arg uid "$uid" --arg scc "$scc" '
      .roleRef.kind=="ClusterRole" and .roleRef.name==("system:openshift:scc:"+$scc) and
      all(.subjects[]; .kind=="ServiceAccount" and .namespace==$ns) and
      any(.metadata.ownerReferences[]; .kind=="Namespace" and .name==$ns and .uid==$uid)
    ' "$EVIDENCE/$ns-scc-$scc.json"
  done
  jq -e --arg sandbox "$sandbox" '.subjects|length==1 and .[0].name==$sandbox' \
    "$EVIDENCE/$ns-scc-privileged.json"
  expect_can yes "$ns" "$sandbox" use securitycontextconstraints.security.openshift.io/privileged -n "$ns"
  for sa in "$gateway" "$gateway-certgen"; do
    expect_can yes "$ns" "$sa" use securitycontextconstraints.security.openshift.io/anyuid -n "$ns"
  done
  # default SA 仅在 Bridge/Expert 启用时由 Worker 加入 anyuid。
  if jq -e 'any(.subjects[]; .name=="default")' "$EVIDENCE/$ns-scc-anyuid.json" >/dev/null; then
    expect_can yes "$ns" default use securitycontextconstraints.security.openshift.io/anyuid -n "$ns"
  fi
  for sa in default "$gateway" "$gateway-certgen" "$sandbox"; do
    expect_can yes "$ns" "$sa" get imagestreams.image.openshift.io --subresource=layers -n "$IMAGE_SOURCE_NS"
    expect_can no "$ns" "$sa" update imagestreams.image.openshift.io --subresource=layers -n "$IMAGE_SOURCE_NS"
    oc -n "$ns" get sa "$sa" -o json | jq '{name:.metadata.name,uid:.metadata.uid,imagePullSecrets}'
    while IFS= read -r secret; do
      oc -n "$ns" get secret "$secret" -o json \
        | jq '{name:.metadata.name,type,keys:(.data|keys)}'
    done < <(oc -n "$ns" get sa "$sa" -o json | jq -r '.imagePullSecrets[]?.name')
  done

  helm status "$TENANT_RELEASE" -n "$ns"
  while IFS= read -r deployment; do
    oc -n "$ns" rollout status "$deployment" --timeout=10m
  done < <(oc -n "$ns" get deploy -o name)
  oc -n "$ns" get deploy,pods -o wide
  oc -n "$ns" get pods -o json | jq '[.items[] | {
    pod:.metadata.name,sa:.spec.serviceAccountName,scc:.metadata.annotations["openshift.io/scc"],
    secrets:.spec.imagePullSecrets,
    containers:([.status.initContainerStatuses[]?,.status.containerStatuses[]?] |
      map({name,image,imageID,ready,state}))
  }]'
done

# 未授权 Namespace 反例：不创建任何源镜像授权。
NEGATIVE_NS="relay-pull-denied-$RUN_ID"
oc create namespace "$NEGATIVE_NS"
expect_can no "$NEGATIVE_NS" default get imagestreams.image.openshift.io --subresource=layers -n "$IMAGE_SOURCE_NS"
```

验收要求：Gateway/Bridge Ready，已有 Sandbox 与 Expert Runtime（若启用）仍正常；SCC reconcile 保持 SA 名称及 UID，不修改运行中 Pod 的 SCC。新 Sandbox Pod 应使用 privileged；Gateway/certgen/Expert 的实际 SCC 应满足其上下文。重复初始化后比较两份 SCC RoleBinding 的 roleRef、subjects 和 ownerReferences，应一致；删除一个自动管理的绑定后重试初始化应补回，且 SA UID、凭据摘要和 PVC UID 不变。仅在可销毁测试租户执行删除测试。SCC 与镜像拉取是独立授权，不能通过扩大 SCC 修复 registry 401/403。certgen 成功 Job 会被 hook 清理，Job 不存在本身不是失败；结合租户 Helm `deployed`、初始化代次和 Worker 日志判断。

## 7. 冷拉取：按实际镜像和实际 SA 逐项测试

`Always` 会访问 registry，但仍可使用本地已有镜像层，因此只设置 `Always` 不算冷拉取。[Kubernetes 镜像拉取策略](https://kubernetes.io/docs/concepts/containers/images/#image-pull-policy)。

准备新加入、无业务的专用验收 worker 节点，架构与目标镜像一致。不要在生产节点执行 `crictl rmi`。下面先检查 CRI 缓存，再在该节点创建探针 Pod。缓存检查以目标 digest/tag 为依据；要验证全部层下载，应使用全新节点，镜像列表不能证明所有共享层都不存在。

生成覆盖 certgen、Gateway、默认 Sandbox、Supervisor、三种平台 Sandbox、Bridge、Expert Runtime 的矩阵。Bridge/Expert 仅在配置启用时出现；外部管理 Worker 配置如果缺少 `sandboxImages`，先补全与 Runner 一致的三种平台镜像再验收。

```bash
jq -e '[.cases[] | select(.role|startswith("platform-"))] | length==3' "$EVIDENCE/worker-images.json"
: > "$EVIDENCE/pull-matrix.tsv"
for ns in "${TENANT_NAMES[@]}"; do
  gateway="$SA_PREFIX$ns"
  sandbox=$(printf '%s' "$gateway-sandbox" | cut -c1-63 | sed 's/-$//')
  jq -r --arg ns "$ns" --arg gateway "$gateway" --arg sandbox "$sandbox" '.cases[] |
    [$ns, .role,
     (if .role=="certgen" then ($gateway+"-certgen") elif .role=="gateway" then $gateway
      elif (.role|startswith("runtime-")) then "default" else $sandbox end),
     .image, (.secrets|tojson), "REPLACE_WITH_COLD_NODE"] | @tsv' \
    "$EVIDENCE/worker-images.json" >> "$EVIDENCE/pull-matrix.tsv"
done
oc get nodes -o wide
${EDITOR:-vi} "$EVIDENCE/pull-matrix.tsv"
```

只编辑最后一列节点名。同一镜像在已有/新租户之间、Gateway/certgen 之间会重复：第二次不能再用已经缓存该 digest 的节点声称冷拉取。可以让不同未缓存镜像共享一个新节点；重复 digest 要换另一台未缓存节点。下面检测到缓存就失败，不自动删除镜像。外部仓库镜像应按其自身认证单独测试；本函数只验收本次共享源内部镜像。

```bash
cold_pull() {
  local ns="$1" role="$2" sa="$3" image="$4" explicit="$5" node="$6"
  local tail repo digest pinned name hostname secrets uid events before baseline
  [[ "$node" != REPLACE_WITH_COLD_NODE ]] || { echo '先填写矩阵节点名' >&2; return 1; }
  [[ "$image" == "$REGISTRY/$IMAGE_SOURCE_NS/"* ]] || {
    echo "不属于本次内部源，需单独验收：$image" >&2; return 1;
  }
  tail=${image#"$REGISTRY/$IMAGE_SOURCE_NS/"}
  if [[ "$tail" == *@sha256:* ]]; then
    digest=${tail##*@}; repo=${tail%@*}; repo=${repo%%:*}
  else
    [[ "$tail" == *:* ]] || tail="$tail:latest"
    digest=$(oc -n "$IMAGE_SOURCE_NS" get istag "$tail" -o json | jq -er '.image.metadata.name')
    repo=${tail%:*}
  fi
  [[ "$digest" == sha256:* ]] || { echo "无有效 digest：$image" >&2; return 1; }
  baseline=$(jq -er --arg image "$image" '.[] | select(.target==$image) | .importedDigest' "$EVIDENCE/imported.json")
  [[ "$digest" == "$baseline" ]] || { echo "镜像 tag 已变化：$image" >&2; return 1; }
  pinned="$REGISTRY/$IMAGE_SOURCE_NS/$repo@$digest"
  name="pull-$RUN_ID-$role"
  before="$EVIDENCE/$ns-$role-cri.before.json"
  # 仅查询 CRI；oc debug 创建临时特权诊断 Pod，但不修改/清理节点镜像。
  oc debug "node/$node" --quiet -- chroot /host crictl images -o json > "$before"
  jq -e '.images | type=="array"' "$before" >/dev/null
  if jq -e --arg d "$digest" --arg ref "$image" 'any(.images[];
      .id==$d or any(.repoDigests[]?; endswith("@"+$d)) or any(.repoTags[]?; .==$ref))' "$before" >/dev/null; then
    echo "缓存已存在，换新节点后重试：$ns/$role $node $digest" >&2; return 1
  fi
  hostname=$(oc get node "$node" -o json | jq -er '.metadata.labels["kubernetes.io/hostname"]')
  secrets=$(oc -n "$ns" get sa "$sa" -o json | jq -c --argjson explicit "$explicit" \
    '($explicit + (.imagePullSecrets//[])) | unique_by(.name)')
  # 使用实际 SA + 显式配置及该 SA 的 pull secrets，复现 Worker 的合并方式。
  # 故意使用不存在的入口，镜像拉取后不会启动 Gateway/应用的业务进程。
  jq -n --arg ns "$ns" --arg name "$name" --arg sa "$sa" --arg image "$pinned" \
    --arg host "$hostname" --arg run "$RUN_ID" --argjson secrets "$secrets" '{
      apiVersion:"v1",kind:"Pod",metadata:{name:$name,namespace:$ns,labels:{"tali.io/pull-acceptance":$run}},
      spec:{serviceAccountName:$sa,automountServiceAccountToken:false,restartPolicy:"Never",activeDeadlineSeconds:300,
        nodeSelector:{"kubernetes.io/hostname":$host},imagePullSecrets:$secrets,
        securityContext:{runAsNonRoot:true,seccompProfile:{type:"RuntimeDefault"}},
        containers:[{name:"pull",image:$image,imagePullPolicy:"Always",command:["/__relay_pull_probe_only__"],
          resources:{requests:{cpu:"10m",memory:"32Mi"},limits:{cpu:"100m",memory:"128Mi"}},
          securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:["ALL"]}}}]}
    }' | oc create -f -
  uid=$(oc -n "$ns" get pod "$name" -o jsonpath='{.metadata.uid}')
  events="$EVIDENCE/$ns-$role-events.json"
  for ((attempt=0;attempt<90;attempt++)); do
    oc -n "$ns" get events --field-selector="involvedObject.uid=$uid" -o json > "$events"
    if jq -e 'any(.items[]; .reason=="Pulled" and (.message|test("Successfully pulled";"i")))' "$events" >/dev/null; then
      oc -n "$ns" get pod "$name" -o json | jq '{name:.metadata.name,node:.spec.nodeName,
        sa:.spec.serviceAccountName,scc:.metadata.annotations["openshift.io/scc"],images:[.spec.containers[].image]}' \
        > "$EVIDENCE/$ns-$role-result.json"
      printf 'PASS cold pull: %s/%s %s %s\n' "$ns" "$sa" "$node" "$pinned"
      oc -n "$ns" delete pod "$name" --wait=true >/dev/null
      return 0
    fi
    sleep 5
  done
  jq '[.items[]|{reason,message}]' "$events"
  echo "冷拉取未通过：$ns/$name；保留 Pod 排查" >&2; return 1
}

while IFS=$'\t' read -r ns role sa image explicit node; do
  cold_pull "$ns" "$role" "$sa" "$image" "$explicit" "$node"
done < "$EVIDENCE/pull-matrix.tsv"
```

成功判据是「事前目标镜像未缓存 + Pod 使用正确 SA/Secrets/节点 + `Successfully pulled` 事件」。探针后续出现 `CreateContainerError` 是不存在入口的预期结果，不将其当作应用健康验收。此探针验证拉取链路；真实 Gateway/certgen/Bridge/Expert/Sandbox 的启动与 SCC 仍以第 5、6 节业务工作负载状态为准。多架构 manifest、别名镜像或共享层可能使缓存列表不足以证明严格冷态，使用新节点避免这类歧义。

负向验证再做一次真实拉取，排除节点全局凭据等旁路授权。这个 Namespace 没有源授权，必须在已产生 default SA 拉取凭据后，因 registry 认证/授权失败而拒绝；调度失败、SCC 拒绝、缺 Secret、DNS 或证书错误都不能替代这一结论。

```bash
NEGATIVE_NODE='<专用验收 worker 节点名>'
NEGATIVE_IMAGE=$(jq -er '.cases[] | select(.role=="certgen") | .image' "$EVIDENCE/worker-images.json")
[[ "$NEGATIVE_IMAGE" == "$REGISTRY/$IMAGE_SOURCE_NS/"* ]]
negative_sa_ready=0
for ((i=0;i<60;i++)); do
  if oc -n "$NEGATIVE_NS" get sa default -o json \
    | jq -e '(.imagePullSecrets//[])|length>0' >/dev/null; then negative_sa_ready=1; break; fi
  sleep 2
done
[[ "$negative_sa_ready" == 1 ]] || { echo '未授权 Namespace 的 SA 凭据尚未就绪' >&2; false; }
negative_hostname=$(oc get node "$NEGATIVE_NODE" -o json | jq -er '.metadata.labels["kubernetes.io/hostname"]')
jq -n --arg ns "$NEGATIVE_NS" --arg image "$NEGATIVE_IMAGE" --arg host "$negative_hostname" '{
  apiVersion:"v1",kind:"Pod",metadata:{name:"pull-denied",namespace:$ns},
  spec:{serviceAccountName:"default",automountServiceAccountToken:false,restartPolicy:"Never",activeDeadlineSeconds:300,
    nodeSelector:{"kubernetes.io/hostname":$host},
    securityContext:{runAsNonRoot:true,seccompProfile:{type:"RuntimeDefault"}},
    containers:[{name:"pull",image:$image,imagePullPolicy:"Always",command:["/__relay_pull_probe_only__"],
      resources:{requests:{cpu:"10m",memory:"32Mi"},limits:{cpu:"100m",memory:"128Mi"}},
      securityContext:{allowPrivilegeEscalation:false,capabilities:{drop:["ALL"]}}}]}
}' | oc create -f -
negative_uid=$(oc -n "$NEGATIVE_NS" get pod pull-denied -o jsonpath='{.metadata.uid}')
negative_pass=0
for ((i=0;i<60;i++)); do
  oc -n "$NEGATIVE_NS" get events --field-selector="involvedObject.uid=$negative_uid" -o json \
    > "$EVIDENCE/negative-events.json"
  if jq -e 'any(.items[]; .reason=="Pulled")' "$EVIDENCE/negative-events.json" >/dev/null; then
    echo 'FAIL：未授权 Namespace 成功拉取，检查额外绑定和节点全局凭据' >&2; break
  fi
  if jq -e 'any(.items[]; .reason=="Failed" and
      (.message|test("Failed to pull image";"i")) and
      (.message|test("unauthorized|authentication required|denied|forbidden|403|401";"i")))' \
      "$EVIDENCE/negative-events.json" >/dev/null; then negative_pass=1; break; fi
  sleep 5
done
[[ "$negative_pass" == 1 ]] || { echo '负向拉取没有获得预期的认证/授权拒绝证据' >&2; false; }
```

## 8. 收尾与故障定位

```bash
oc -n "$CONTROL_NS" logs "deploy/$WORKER_DEPLOY" -c control-worker --since=60m \
  > "$EVIDENCE/worker.log"
for ns in "${TENANT_NAMES[@]}"; do
  oc -n "$ns" get events --sort-by=.lastTimestamp
  helm history "$TENANT_RELEASE" -n "$ns"
  # 仅清理本次探针，不删除租户已有 Pod。
  oc -n "$ns" delete pod -l "tali.io/pull-acceptance=$RUN_ID" --ignore-not-found
done
oc delete namespace "$NEGATIVE_NS"
# 仅删除本次记录的验收实例，保留已有业务实例。
for project in "${PROJECT_IDS[@]}"; do
  select_project "$project"
  instance=$(jq -er .instanceId "$EVIDENCE/$project-instance-created.json")
  api DELETE "/api/v1/projects/$project/instances/$instance" | jq .
done
rm -f "$COOKIE_JAR" "${AUTH_FILE:-$EVIDENCE/registry-auth.json}"
```

新建验收 Project 通过 Relay 正常删除流程清理，不直接删除其 Namespace 或数据库记录。已有业务租户、SA、源 RoleBinding 不删除。

| 现象 | 检查与通过条件 |
| --- | --- |
| Worker 403 / bind 被拒绝 | 第 4 节检查源 Namespace 的 Role/RoleBinding；不要改成 cluster-admin |
| `source mismatch` | Worker 的 `imageSourceNamespace` 与所有内部镜像 URL 的路径一致 |
| pull readiness 超时 | 实际 SA 的 pull-secret 引用、Secret 是否存在、registry key 是否匹配；不要只增加 timeout |
| `ImagePullBackOff` / 401 / 403 | 第 6 节 `imagestreams/layers` 授权、Pod 的实际 imagePullSecrets 和 SA；明确认证与授权分别是否成功 |
| `FailedCreate` / SCC denied | 检查租户 SCC 绑定、Worker 对两个 SCC 角色的 bind 权限和实际 Pod SA；确认 Chart 与 Worker 同步升级。拉取授权不授予 SCC |
| 冷拉取 probe Pending | 检查节点 taint、调度、配额；Pending 不算镜像拉取通过 |
| negative check 返回 yes | 源可能被其他 RoleBinding/ClusterRoleBinding 广泛授权，隔离验收失败 |

最终记录：已有和新建 Project 均 `ready` 且代次一致；正常已有租户及重复 reconcile 的 SA UID 未变；源 RoleBinding/Worker 权限符合预期；未授权 Namespace 被拒绝；矩阵中的内部镜像冷拉取有证据；真实业务 Pod Ready，privileged 仅授予 Sandbox 专用 SA，anyuid 仅授予已启用工作负载对应 SA。禁用的运行时或外部镜像明确标记为未覆盖，不算通过。

## 9. 失败回退

先保存失败 Job、Pod 事件和 release 状态，再选择下面一种恢复路径。**不要删除旧 ImageStream/tag、凭据 Secret 或 PVC；不要执行 `crictl rmi`。** 此次镜像配置修改不要求数据库降级；如果发布包同时包含其他数据库迁移，必须先确认旧版本能读取当前 schema，不能把 Helm rollback 当作数据库恢复。

```bash
helm status "$RELEASE" -n "$CONTROL_NS" -o json > "$EVIDENCE/status.failed.json" || true
helm history "$RELEASE" -n "$CONTROL_NS" -o json > "$EVIDENCE/history.failed.json" || true
oc -n "$CONTROL_NS" get pods,jobs -o wide > "$EVIDENCE/workloads.failed.txt"
oc -n "$CONTROL_NS" get events --sort-by=.lastTimestamp > "$EVIDENCE/events.failed.txt"
oc -n "$CONTROL_NS" get jobs -l app.kubernetes.io/component=credential-bootstrap -o name \
  | while IFS= read -r job; do oc -n "$CONTROL_NS" logs "$job" > "$EVIDENCE/${job#*/}.log" 2>&1 || true; done
# 刚失败的 Helm 命令可能尚未执行过前面的变量赋值，重新发现 Deployment。
component_deploy() {
  oc -n "$CONTROL_NS" get deploy -l "app.kubernetes.io/instance=$RELEASE,app.kubernetes.io/component=$1" \
    -o json | jq -er '.items | if length==1 then .[0].metadata.name else error("Deployment 数量不为 1") end'
}
CONTROL_DEPLOY=$(component_deploy control)
WORKER_DEPLOY=$(component_deploy control-worker)
RUNNER_DEPLOY=$(component_deploy runner)
```

### 9.1 只撤销统一镜像源迁移（优先选择）

适用于修复版本本身可用，但内部镜像导入、拉取或节点访问失败。继续使用修复后的 Chart/Control 镜像，把 Runtime 地址恢复为本次源清单中的原始地址。原始仓库必须仍可访问、原凭据仍存在。不要额外重新传入 OCP profile 覆盖最后的 `false`。如果本次还将 Control 镜像迁到了与原内部源不同的 namespace，Bridge 会跟随这个新 Control 地址，不能只回退源设置；使用 9.2 恢复完整基线。

```bash
# 恢复旧内部源的授权设置，避免原地址属于另一个 namespace 时被 preflight 拒绝。
if [[ "$MODE" == upgrade ]]; then
  jq '{openshift:{enabled:(if .openshift.enabled == null then true else .openshift.enabled end),
    imageSourceNamespace:(.openshift.imageSourceNamespace // ""),
    imageRegistryHost:(.openshift.imageRegistryHost // ""),runtimeImages:{enabled:false}}}' \
    "$EVIDENCE/values.before.json" > "$EVIDENCE/values.source-revert.json"
else
  printf '{"openshift":{"runtimeImages":{"enabled":false}}}\n' > "$EVIDENCE/values.source-revert.json"
fi
helm upgrade "$RELEASE" "$FIXED_CHART" -n "$CONTROL_NS" \
  "${BASE_ARGS[@]}" -f "$EVIDENCE/values.shared.json" -f "$EVIDENCE/values.source-revert.json" \
  --wait --wait-for-jobs --timeout 30m
for deployment in "$CONTROL_DEPLOY" "$WORKER_DEPLOY" "$RUNNER_DEPLOY"; do
  oc -n "$CONTROL_NS" rollout status "deploy/$deployment" --timeout=10m
done
# 对所有未删除 Project 进行一次收敛，修复已升级及迁移失败的租户 Gateway/Bridge。
# 该命令会逐租户运行 Helm；应在发布窗口执行，并检查汇总 failed/skipped。
oc -n "$CONTROL_NS" exec "deploy/$WORKER_DEPLOY" -c control-worker -- \
  node /app/apps/control/.output/tools/project-runtime-reconcile.mjs \
  > "$EVIDENCE/reconcile-after-source-revert.log" 2>&1
cat "$EVIDENCE/reconcile-after-source-revert.log"
if [[ "$MODE" == upgrade ]]; then
  oc -n "$CONTROL_NS" get secret "$CREDENTIAL_SECRET" -o json | jq -cS .data | shasum -a 256 > "$EVIDENCE/credentials.recovered.sha256"
  diff -u "$EVIDENCE/credentials.before.sha256" "$EVIDENCE/credentials.recovered.sha256"
fi
```

重新执行第 4 节的 Worker/Runner 配置读取与一致性比较，但跳过“全部镜像必须属于内部源”的断言。将实际 runtime 地址与 `source.yaml` 的源计划逐项比较。第 5、6 节中的已有/新租户初始化、SA UID、Gateway/Bridge Ready 检查仍须通过。

**已经创建的 Agent 实例不会因配置回退自动替换其镜像。** 本次新建的验收 Agent 通过 Relay 正常删除后重新创建，确认使用源仓库；已有业务 Agent 按原有实例更新流程安排维护，不直接批量删除 Pod/PVC。保留内部镜像源与授权，直到所有仍引用它的实例迁移完毕。

### 9.2 回退整个控制面版本

仅用于 `MODE=upgrade`，且旧 Chart 已支持初始化 Job 的 `pre-rollback`。`--atomic` 的失败升级可能已经自动回退；先读取状态，确认是否还需要执行下面的基线回退。即使自动回退成功，租户 Helm release 仍可能已经变更。

```bash
[[ "$MODE" == upgrade ]]
PREV_REV=$(cat "$EVIDENCE/control-revision.before.txt")
helm status "$RELEASE" -n "$CONTROL_NS" -o json | jq '{version,status:.info.status}'
# 明确执行基线回退会产生一个新的 revision，属于正常行为。
helm rollback "$RELEASE" "$PREV_REV" -n "$CONTROL_NS" --wait --wait-for-jobs --timeout 30m
for deployment in "$CONTROL_DEPLOY" "$WORKER_DEPLOY" "$RUNNER_DEPLOY"; do
  oc -n "$CONTROL_NS" rollout status "deploy/$deployment" --timeout=10m
done
# 控制面 rollback 不会回退 Worker 已部署的租户 release，须让恢复后的 Worker 收敛。
oc -n "$CONTROL_NS" exec "deploy/$WORKER_DEPLOY" -c control-worker -- \
  node /app/apps/control/.output/tools/project-runtime-reconcile.mjs \
  > "$EVIDENCE/reconcile-after-version-rollback.log" 2>&1
cat "$EVIDENCE/reconcile-after-version-rollback.log"
if [[ "$MODE" == upgrade ]]; then
  oc -n "$CONTROL_NS" get secret "$CREDENTIAL_SECRET" -o json | jq -cS .data | shasum -a 256 > "$EVIDENCE/credentials.recovered.sha256"
  diff -u "$EVIDENCE/credentials.before.sha256" "$EVIDENCE/credentials.recovered.sha256"
fi
helm history "$RELEASE" -n "$CONTROL_NS" -o json > "$EVIDENCE/history.recovered.json"
```

若旧镜像没有上述 reconcile 工具，使用恢复版本的 Relay 项目初始化接口逐项重试，并等待它的周期巡检；不能因为控制面 `deployed` 就宣布租户恢复。汇总 `skipped` 可能是租户 lease 被其他任务持有，需要等任务结束重试并逐项确认状态。回退不会还原数据库、外部 Secret、Agent 实例或新增 Project；这些不能混同于 release 回退。

### 9.3 首次部署失败

首装没有可回退的 revision。修正镜像/网络/SCC/存储问题后，使用第 3 节相同 values 执行 `helm upgrade --install` 重试，或带 `--set openshift.runtimeImages.enabled=false` 先恢复上游地址。保留初始化生成的 Secret 和 PVC，以验证重入。不要为重试直接删除 namespace、凭据 Secret 或数据库卷。

```bash
[[ "$MODE" == install ]]
helm upgrade --install "$RELEASE" "$FIXED_CHART" -n "$CONTROL_NS" \
  "${BASE_ARGS[@]}" -f "$EVIDENCE/values.shared.json" \
  --wait --wait-for-jobs --timeout 30m
```

### 9.4 发布前验证错误会被拦截

这一步只渲染，不修改集群；用于验证错误 tag 不会混入发布。真实升级失败后的恢复以 9.1/9.2 为准，不在业务镜像上人为制造坏 tag。

```bash
if helm template "$RELEASE" "$FIXED_CHART" -n "$CONTROL_NS" --kube-version 1.29.0 \
  "${BASE_ARGS[@]}" -f "$EVIDENCE/values.shared.json" --set 'openshell.image.tag=bad:tag' \
  > "$EVIDENCE/rejected-render.yaml" 2> "$EVIDENCE/rejected-render.log"; then
  echo 'FAIL: 非法镜像 tag 未被拒绝' >&2; false
fi
grep -F 'Invalid tag/digest' "$EVIDENCE/rejected-render.log"
```

回退验收完成条件：Control/Worker/Runner rollout 完成；实际 Worker/Runner 地址一致；受影响的租户初始化 ready、Gateway/Bridge Ready；Agent 按预期版本启动；原 SA UID 与凭据保持；没有通过扩大 SCC 或删除持久化数据绕过故障。
