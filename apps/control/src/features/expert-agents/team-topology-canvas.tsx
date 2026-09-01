import { memo, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Bot, Network } from "lucide-react";
import type { ExpertAgentDelegation } from "@tali/contracts";
import type { ExpertAgentListItem } from "@/features/expert-agents/expert-agent-types";
import { cn } from "@/lib/utils";

type TopologyNodeData = {
  kind: "CURRENT" | "EXPERT";
  name: string;
  note: string;
  enabled: boolean;
};

type TopologyNode = Node<TopologyNodeData, "agent">;

const AgentTopologyNode = memo(function AgentTopologyNode({ data, selected }: NodeProps<TopologyNode>) {
  const Icon = data.kind === "CURRENT" ? Network : Bot;
  return (
    <div
      className={cn(
        "w-56 border bg-card px-4 py-3 text-left shadow-sm transition-[border-color,box-shadow,opacity]",
        selected ? "border-primary ring-2 ring-primary/15" : "border-border",
        !data.enabled && "opacity-55",
      )}
    >
      {data.kind === "EXPERT" ? <Handle type="target" position={Position.Top} className="!size-2 !border-background !bg-muted-foreground" /> : null}
      <div className="flex items-start gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center border", data.kind === "CURRENT" ? "border-primary/30 bg-primary/5 text-primary" : "bg-muted/40 text-muted-foreground")}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-semibold">{data.name}</strong>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{data.note}</span>
        </span>
      </div>
      {data.kind === "CURRENT" ? <Handle type="source" position={Position.Bottom} className="!size-2 !border-background !bg-primary" /> : null}
    </div>
  );
});

const nodeTypes = { agent: AgentTopologyNode };

export function TeamTopologyCanvas({
  agentId,
  agentName,
  delegations,
  experts,
  selectedId,
  onSelect,
}: {
  agentId: string;
  agentName: string;
  delegations: ExpertAgentDelegation[];
  experts: ExpertAgentListItem[];
  selectedId: string | null;
  onSelect: (expertAgentId: string | null) => void;
}) {
  const expertById = useMemo(() => new Map(experts.map((expert) => [expert.id, expert])), [experts]);
  const graph = useMemo(() => {
    const gap = 264;
    const width = Math.max(0, (delegations.length - 1) * gap);
    const currentX = width / 2;
    const nodes: TopologyNode[] = [
      {
        id: agentId,
        type: "agent",
        position: { x: currentX, y: 24 },
        data: {
          kind: "CURRENT",
          name: agentName,
          note: `${delegations.filter((item) => item.enabled).length} active delegation${delegations.filter((item) => item.enabled).length === 1 ? "" : "s"}`,
          enabled: true,
        },
        selected: selectedId === null,
        draggable: false,
        connectable: false,
        ariaLabel: `${agentName}, current Agent`,
      },
      ...delegations.map((delegation, index): TopologyNode => {
        const expert = expertById.get(delegation.expertAgentId);
        return {
          id: delegation.expertAgentId,
          type: "agent",
          position: { x: index * gap, y: 190 },
          data: {
            kind: "EXPERT",
            name: expert?.name ?? "Unavailable Agent",
            note: delegation.enabled ? `${delegation.delegationPolicy.replaceAll("_", " ")} · ${delegation.executionPolicy}` : "Relationship paused",
            enabled: delegation.enabled,
          },
          selected: selectedId === delegation.expertAgentId,
          draggable: false,
          connectable: false,
          ariaLabel: `${expert?.name ?? "Unavailable Agent"}, ${delegation.enabled ? "enabled" : "paused"} delegation`,
        };
      }),
    ];
    const edges: Edge[] = delegations.map((delegation) => ({
      id: `${agentId}:${delegation.expertAgentId}`,
      source: agentId,
      target: delegation.expertAgentId,
      type: "smoothstep",
      animated: false,
      selectable: true,
      focusable: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: {
        stroke: delegation.enabled ? "var(--primary)" : "var(--muted-foreground)",
        strokeWidth: 1.25,
        strokeDasharray: "5 5",
        opacity: delegation.enabled ? 0.72 : 0.38,
      },
      ariaLabel: `Delegation from ${agentName} to ${expertById.get(delegation.expertAgentId)?.name ?? "Unavailable Agent"}`,
    }));
    return { nodes, edges };
  }, [agentId, agentName, delegations, expertById, selectedId]);

  return (
    <div className="h-[25rem] min-h-80 overflow-hidden border bg-surface-subtle/35" aria-label="Agent delegation topology">
      <ReactFlow
        key={delegations.map((item) => item.expertAgentId).join(":")}
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesReconnectable={false}
        deleteKeyCode={null}
        minZoom={0.55}
        maxZoom={1.3}
        fitView
        fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
        onPaneClick={() => onSelect(null)}
        onNodeClick={(_event, node) => onSelect(node.id === agentId ? null : node.id)}
        onEdgeClick={(_event, edge) => onSelect(edge.target)}
        colorMode="light"
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{
          "controls.ariaLabel": "Topology controls",
          "controls.fitView.ariaLabel": "Fit Agent topology to view",
          "controls.zoomIn.ariaLabel": "Zoom in Agent topology",
          "controls.zoomOut.ariaLabel": "Zoom out Agent topology",
        }}
      >
        <Background color="var(--border)" gap={22} size={1} />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
