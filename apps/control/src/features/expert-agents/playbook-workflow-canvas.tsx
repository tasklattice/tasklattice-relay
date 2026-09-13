import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Circle,
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Network,
  ShieldCheck,
  Shuffle,
  UserCheck,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ExpertAgentExecutionSpec } from "@tali/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WorkflowExecution = Extract<ExpertAgentExecutionSpec, { mode: "WORKFLOW" }>;
type WorkflowNode = WorkflowExecution["nodes"][number];
type WorkflowTransition = WorkflowExecution["transitions"][number];

type PlaybookNodeData = {
  entrypoint: boolean;
  node: WorkflowNode;
  outgoing: WorkflowTransition[];
};

type PlaybookCanvasNode = Node<PlaybookNodeData, "playbook">;

const NODE_WIDTH = 272;
const NODE_MIN_HEIGHT = 132;
const OUTCOME_ROW_HEIGHT = 28;

const nodeLabels: Record<WorkflowNode["type"], string> = {
  REASON: "Reason",
  KNOWLEDGE: "Knowledge",
  TOOL: "Tool",
  DECISION: "Decision",
  TRANSFORM: "Transform",
  VERIFY: "Verify",
  DELEGATE: "Delegate",
  APPROVAL: "Approval",
  RESPONSE: "Response",
  NORMALIZE_INPUT: "Normalize input",
  CLASSIFY_INTENT: "Classify intent",
  RETRIEVE_EVIDENCE: "Retrieve evidence",
  RENDER_TEMPLATE: "Render response",
  ESCALATE: "Escalate",
  END: "End",
};

const nodeIcons: Record<WorkflowNode["type"], LucideIcon> = {
  REASON: Bot,
  KNOWLEDGE: BookOpen,
  TOOL: Wrench,
  DECISION: GitBranch,
  TRANSFORM: Shuffle,
  VERIFY: ShieldCheck,
  DELEGATE: Network,
  APPROVAL: UserCheck,
  RESPONSE: MessageSquare,
  NORMALIZE_INPUT: Workflow,
  CLASSIFY_INTENT: GitBranch,
  RETRIEVE_EVIDENCE: BookOpen,
  RENDER_TEMPLATE: MessageSquare,
  ESCALATE: UserCheck,
  END: Circle,
};

function nodeTone(type: WorkflowNode["type"]): string {
  if (["VERIFY", "RESPONSE", "RENDER_TEMPLATE", "END"].includes(type)) {
    return "border-success-border bg-success-surface text-success-foreground";
  }
  if (["DECISION", "CLASSIFY_INTENT", "APPROVAL", "ESCALATE"].includes(type)) {
    return "border-warning-border bg-warning-surface text-warning-foreground";
  }
  if (["KNOWLEDGE", "RETRIEVE_EVIDENCE", "TOOL"].includes(type)) {
    return "border-info-border bg-info-surface text-info-foreground";
  }
  return "border-border bg-muted text-foreground";
}

function estimatedNodeHeight(node: PlaybookCanvasNode): number {
  return Math.max(NODE_MIN_HEIGHT, 112 + node.data.outgoing.length * OUTCOME_ROW_HEIGHT);
}

function edgeColor(outcome: string): string {
  const normalized = outcome.toUpperCase();
  if (normalized.includes("FAIL") || normalized.includes("ERROR") || normalized.includes("REJECT")) return "var(--destructive)";
  if (normalized.includes("APPROV") || normalized.includes("WAIT") || normalized.includes("HUMAN")) return "var(--warning)";
  if (normalized.includes("SUCCESS") || normalized.includes("MATCH") || normalized === "NEXT") return "var(--success)";
  return "var(--muted-foreground)";
}

function initialFocusIds(execution: WorkflowExecution, limit = 3): Set<string> {
  const focused = new Set<string>([execution.entrypoint]);
  const pending = [execution.entrypoint];
  const nodeTypeById = new Map(execution.nodes.map((node) => [node.id, node.type]));
  while (pending.length && focused.size < limit) {
    const source = pending.shift()!;
    const targets = execution.transitions
      .filter((transition) => transition.from === source)
      .map((transition) => transition.to);
    const preferredTargets = targets.filter((target) => nodeTypeById.get(target) !== "END");
    const nextTargets = preferredTargets.length ? preferredTargets : targets;
    nextTargets.forEach((target) => {
      if (focused.size >= limit || focused.has(target)) return;
      focused.add(target);
      pending.push(target);
    });
  }
  return focused;
}

export function createPlaybookCanvasModel(
  execution: WorkflowExecution,
  selectedId: string | null,
): { edges: Edge[]; nodes: PlaybookCanvasNode[] } {
  const nodes: PlaybookCanvasNode[] = execution.nodes.map((node) => ({
    id: node.id,
    type: "playbook",
    position: { x: 0, y: 0 },
    selected: node.id === selectedId,
    data: {
      entrypoint: node.id === execution.entrypoint,
      node,
      outgoing: execution.transitions.filter((transition) => transition.from === node.id),
    },
    ariaLabel: `${nodeLabels[node.type]} step, ${node.id}${node.id === execution.entrypoint ? ", entrypoint" : ""}`,
  }));
  const edges: Edge[] = execution.transitions.map((transition) => ({
    id: `${transition.from}:${transition.outcome}`,
    source: transition.from,
    sourceHandle: transition.outcome,
    target: transition.to,
    targetHandle: "target",
    type: "smoothstep",
    label: transition.outcome,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: { stroke: edgeColor(transition.outcome), strokeWidth: 1.5 },
    labelStyle: { fill: "var(--foreground)", fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: "var(--background)", stroke: "var(--border)" },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 2,
    ariaLabel: `${transition.outcome} transition from ${transition.from} to ${transition.to}`,
  }));
  return { edges, nodes };
}

export function layoutPlaybookNodes(nodes: PlaybookCanvasNode[], edges: Edge[]): PlaybookCanvasNode[] {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    ranksep: 104,
    nodesep: 48,
    edgesep: 28,
    marginx: 36,
    marginy: 36,
  });
  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: estimatedNodeHeight(node) }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const position = graph.node(node.id) as { x: number; y: number };
    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - estimatedNodeHeight(node) / 2,
      },
    };
  });
}

export function canConnectPlaybook(execution: WorkflowExecution, source: string, target: string): boolean {
  if (source === target) return false;
  if (execution.nodes.find((node) => node.id === source)?.type === "END") return false;
  if (target === execution.entrypoint) return false;
  const outgoing = new Map<string, string[]>();
  execution.transitions.forEach((transition) => {
    outgoing.set(transition.from, [...(outgoing.get(transition.from) ?? []), transition.to]);
  });
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === source) return false;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return true;
}

const PlaybookNodeCard = memo(function PlaybookNodeCard({ data, selected }: NodeProps<PlaybookCanvasNode>) {
  const Icon = nodeIcons[data.node.type];
  const attempts = data.node.retry?.maxAttempts ?? 1;
  const terminal = data.node.type === "END";
  return (
    <div
      className={cn(
        "w-[17rem] border bg-card text-foreground shadow-sm transition-[border-color,box-shadow]",
        selected ? "border-info shadow-md ring-2 ring-info/15" : "border-border hover:border-muted-foreground/60",
      )}
    >
      {!data.entrypoint ? (
        <Handle
          id="target"
          type="target"
          position={Position.Left}
          className="!size-2.5 !border-2 !border-background !bg-muted-foreground"
          aria-label={`Connect into ${data.node.id}`}
        />
      ) : null}
      <div className="flex items-start gap-3 border-b px-3.5 py-3">
        <span className={cn(
          "grid size-8 shrink-0 place-items-center border",
          nodeTone(data.node.type),
        )}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <strong className="truncate text-sm font-semibold">{nodeLabels[data.node.type]}</strong>
            {data.entrypoint ? <span className="shrink-0 text-[10px] font-medium text-success-foreground">Entry</span> : null}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{data.node.id}</span>
        </span>
      </div>
      <div className="space-y-2 px-3.5 py-3">
        {terminal ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5" /> Terminal outcome</div>
        ) : (
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>{data.node.timeoutMs ? `${data.node.timeoutMs} ms timeout` : "Run timeout"}</span>
            <span>{attempts} attempt{attempts === 1 ? "" : "s"}</span>
          </div>
        )}
        {data.outgoing.length ? (
          <div className="border-t pt-2">
            {data.outgoing.map((transition, index) => (
              <div key={transition.outcome} className="relative flex min-h-7 items-center justify-between gap-2 text-[10px]">
                <span className="truncate font-medium">{transition.outcome}</span>
                <span className="max-w-28 truncate font-mono text-muted-foreground">{transition.to}</span>
                <Handle
                  id={transition.outcome}
                  type="source"
                  position={Position.Right}
                  isConnectableStart={false}
                  isConnectableEnd={false}
                  className="!size-2 !border-2 !border-background"
                  style={{ top: 100 + index * OUTCOME_ROW_HEIGHT, background: edgeColor(transition.outcome) }}
                  aria-label={`${transition.outcome} transition to ${transition.to}`}
                />
              </div>
            ))}
          </div>
        ) : null}
        {!terminal ? (
          <div className="relative flex min-h-7 items-center justify-end border-t pt-2 text-[10px] text-muted-foreground">
            Drag to add transition
            <Handle
              id="__new__"
              type="source"
              position={Position.Right}
              className="!size-3 !border-2 !border-background !bg-info"
              style={{ top: "calc(100% - 18px)" }}
              aria-label={`Add transition from ${data.node.id}`}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

const nodeTypes = { playbook: PlaybookNodeCard };

export function PlaybookWorkflowCanvas({
  execution,
  onConnect,
  onSelect,
  selectedId,
}: {
  execution: WorkflowExecution;
  onConnect: (source: string, target: string) => void;
  onSelect: (nodeId: string | null) => void;
  selectedId: string | null;
}) {
  const model = useMemo(() => createPlaybookCanvasModel(execution, selectedId), [execution, selectedId]);
  const topologyKey = execution.nodes.map((node) => node.id).sort().join(":");
  const [nodes, setNodes, onNodesChange] = useNodesState<PlaybookCanvasNode>(layoutPlaybookNodes(model.nodes, model.edges));
  const [instance, setInstance] = useState<ReactFlowInstance<PlaybookCanvasNode, Edge> | null>(null);
  const focusedNodeIds = useMemo(() => initialFocusIds(execution), [execution]);
  const initialFocusNodes = useMemo(() => nodes.filter((node) => focusedNodeIds.has(node.id)), [focusedNodeIds, nodes]);
  const initialFocusCenter = useMemo(() => {
    const left = Math.min(...initialFocusNodes.map((node) => node.position.x));
    const right = Math.max(...initialFocusNodes.map((node) => node.position.x + NODE_WIDTH));
    const top = Math.min(...initialFocusNodes.map((node) => node.position.y));
    const bottom = Math.max(...initialFocusNodes.map((node) => node.position.y + estimatedNodeHeight(node)));
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }, [initialFocusNodes]);

  useEffect(() => {
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]));
      const layouted = layoutPlaybookNodes(model.nodes, model.edges);
      return layouted.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
    });
  }, [model, setNodes, topologyKey]);

  const arrange = useCallback(() => {
    setNodes(layoutPlaybookNodes(model.nodes, model.edges));
    window.requestAnimationFrame(() =>
      void instance?.fitView({ padding: 0.18, duration: 240, minZoom: 0.55, maxZoom: 1 }),
    );
  }, [instance, model.edges, model.nodes, setNodes]);

  const validConnection = useCallback((connection: Connection | Edge) => (
    Boolean(connection.source && connection.target)
    && canConnectPlaybook(execution, connection.source, connection.target)
  ), [execution]);

  return (
    <div className="h-[34rem] min-h-[28rem] overflow-hidden bg-surface-subtle/35" aria-label="Playbook workflow canvas">
      <ReactFlow<PlaybookCanvasNode, Edge>
        nodes={nodes}
        edges={model.edges}
        nodeTypes={nodeTypes}
        onInit={(flow) => {
          setInstance(flow);
          window.setTimeout(() =>
            void flow.setCenter(initialFocusCenter.x, initialFocusCenter.y, { zoom: 0.65 }),
          120);
        }}
        onNodesChange={onNodesChange}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onEdgeClick={(_event, edge) => onSelect(edge.source)}
        onPaneClick={() => onSelect(null)}
        onConnect={(connection) => {
          if (connection.source && connection.target) onConnect(connection.source, connection.target);
        }}
        isValidConnection={validConnection}
        nodesDraggable
        nodesConnectable
        edgesReconnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Meta"
        minZoom={0.35}
        maxZoom={1.5}
        colorMode="light"
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{
          "controls.ariaLabel": "Playbook canvas controls",
          "controls.fitView.ariaLabel": "Fit Playbook to view",
          "controls.zoomIn.ariaLabel": "Zoom in Playbook",
          "controls.zoomOut.ariaLabel": "Zoom out Playbook",
          "minimap.ariaLabel": "Playbook overview map",
        }}
      >
        <Background color="var(--border)" gap={22} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
        {nodes.length >= 8 ? <MiniMap position="bottom-right" pannable zoomable nodeColor="var(--muted-foreground)" /> : null}
        <Panel position="top-right">
          <Button type="button" variant="outline" size="sm" className="min-h-11 bg-background shadow-sm" onClick={arrange}>
            <LayoutGrid /> Arrange
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
