"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { AlertTriangle, GitBranch, Plus, Save, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { saveWorkflowAction } from "@/app/actions/workflows";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { TriggerKind, WorkflowDefinition, WorkflowNode } from "@/lib/db/schema";
import {
  ACTION_LABEL,
  ACTION_TYPES,
  MAX_NODES,
  OPS,
  TRIGGERS,
  TRIGGER_KINDS,
  validateDefinition,
  type ActionType,
} from "@/lib/workflow/model";
import { cn } from "@/lib/utils";

type NData = Record<string, unknown> & { issue?: string };
type FlowNode = Node<NData>;

const OP_LABEL: Record<(typeof OPS)[number], string> = {
  eq: "is",
  neq: "is not",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
};

const DEFAULTS: Record<ActionType, Record<string, unknown>> = {
  email: { to: "hr", subject: "", body: "" },
  slack: { url: "", message: "" },
  teams: { url: "", message: "" },
  whatsapp: { to: "", message: "" },
  webhook: { url: "", message: "" },
  approval: { title: "", assigneeRole: "hr_admin" },
  task: { title: "", assigneeRole: "hr_admin" },
  notify: { audience: "hr", title: "" },
};

function summary(n: { type?: string; data: NData }): string {
  if (n.type === "trigger")
    return TRIGGERS[n.data.kind as TriggerKind]?.label ?? "Choose a trigger";
  if (n.type === "condition")
    return n.data.field
      ? `${n.data.field} ${OP_LABEL[n.data.op as (typeof OPS)[number]] ?? ""} ${n.data.value ?? ""}`
      : "Set a condition";
  const c = (n.data.config ?? {}) as Record<string, string>;
  return c.title || c.subject || c.message || "Not set up yet";
}

const box = (tone: string, selected: boolean, issue?: string) =>
  cn(
    "bg-card w-56 rounded-xl border-2 px-3 py-2 text-left shadow-sm",
    tone,
    selected && "ring-primary ring-2",
    issue && "border-destructive",
  );

function Card({
  id,
  data,
  selected,
  type,
  tone,
  icon,
  title,
}: NodeProps<FlowNode> & { tone: string; icon: React.ReactNode; title: string }) {
  void id;
  return (
    <div className={box(tone, !!selected, data.issue)}>
      <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {icon} {title}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">{summary({ type, data })}</p>
      {data.issue && (
        <p className="text-destructive mt-1 flex items-start gap-1 text-xs">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {data.issue}
        </p>
      )}
    </div>
  );
}

const TriggerNode = (p: NodeProps<FlowNode>) => (
  <>
    <Card {...p} tone="border-primary/50" icon={<Zap className="size-3" />} title="When" />
    <Handle type="source" position={Position.Right} />
  </>
);
const ConditionNode = (p: NodeProps<FlowNode>) => (
  <>
    <Handle type="target" position={Position.Left} />
    <Card {...p} tone="border-warning/60" icon={<GitBranch className="size-3" />} title="If" />
    <Handle type="source" position={Position.Right} id="true" style={{ top: "30%" }} />
    <Handle type="source" position={Position.Right} id="false" style={{ top: "72%" }} />
    <span className="text-success absolute top-[12%] -right-9 text-[10px] font-semibold">yes</span>
    <span className="text-muted-foreground absolute top-[58%] -right-8 text-[10px] font-semibold">
      no
    </span>
  </>
);
const ActionNode = (p: NodeProps<FlowNode>) => {
  const a = p.data.action as ActionType;
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Card
        {...p}
        tone="border-border"
        icon={<Plus className="size-3" />}
        title={ACTION_LABEL[a] ?? "Action"}
      />
      {a === "approval" ? (
        <>
          <Handle type="source" position={Position.Right} id="approved" style={{ top: "30%" }} />
          <Handle type="source" position={Position.Right} id="rejected" style={{ top: "72%" }} />
          <span className="text-success absolute top-[12%] -right-14 text-[10px] font-semibold">
            approved
          </span>
          <span className="text-destructive absolute top-[58%] -right-14 text-[10px] font-semibold">
            rejected
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </>
  );
};
const nodeTypes = { trigger: TriggerNode, condition: ConditionNode, action: ActionNode };

const toFlow = (n: WorkflowNode): FlowNode => ({
  id: n.id,
  type: n.type,
  position: n.position,
  data: n.data,
});
const toEdge = (e: WorkflowDefinition["edges"][number]): Edge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle ?? undefined,
  label:
    e.sourceHandle === "true"
      ? "yes"
      : e.sourceHandle === "false"
        ? "no"
        : (e.sourceHandle ?? undefined),
  markerEnd: { type: MarkerType.ArrowClosed },
});

export interface BuilderProps {
  id: string;
  initialName: string;
  initialDescription: string;
  initialDefinition: WorkflowDefinition;
}

export function WorkflowBuilder(props: BuilderProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

function Inner({ id, initialName, initialDescription, initialDefinition }: BuilderProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    initialDefinition.nodes.map(toFlow),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialDefinition.edges.map(toEdge));
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  const definition = useMemo<WorkflowDefinition>(
    () => ({
      nodes: nodes.map((n) => {
        const { issue, ...data } = n.data;
        void issue;
        return { id: n.id, type: n.type as WorkflowNode["type"], position: n.position, data };
      }),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      })),
    }),
    [nodes, edges],
  );
  const issues = useMemo(() => validateDefinition(definition), [definition]);
  const issueByNode = useMemo(
    () => new Map(issues.filter((i) => i.nodeId).map((i) => [i.nodeId!, i.message])),
    [issues],
  );
  const shown = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, issue: issueByNode.get(n.id) } })),
    [nodes, issueByNode],
  );
  const trigger = (definition.nodes.find((n) => n.type === "trigger")?.data.kind ??
    "leave.applied") as TriggerKind;
  const sel = nodes.find((n) => n.id === selected) ?? null;

  const touch = () => setDirty(true);
  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((es) =>
        addEdge(
          {
            ...toEdge({
              id: `${c.source}-${c.sourceHandle ?? "next"}-${c.target}`,
              source: c.source,
              target: c.target,
              sourceHandle: c.sourceHandle,
            }),
          },
          es,
        ),
      );
      setDirty(true);
    },
    [setEdges],
  );

  function add(type: "condition" | "action", action?: ActionType) {
    if (nodes.length >= MAX_NODES) return void toast.error(`At most ${MAX_NODES} steps.`);
    const nid = `${type[0]}${Date.now().toString(36)}`;
    const maxX = Math.max(0, ...nodes.map((n) => n.position.x));
    const node: FlowNode = {
      id: nid,
      type,
      position: { x: maxX + 260, y: 40 + (nodes.length % 3) * 130 },
      data:
        type === "condition"
          ? { field: TRIGGERS[trigger].fields[0].path, op: "eq", value: "" }
          : { action, config: { ...DEFAULTS[action!] } },
    };
    setNodes((ns) => [...ns, node]);
    setSelected(nid);
    touch();
  }

  function patch(nodeId: string, data: Partial<NData>) {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)));
    touch();
  }
  const patchConfig = (nodeId: string, key: string, value: unknown) => {
    const n = nodes.find((x) => x.id === nodeId);
    patch(nodeId, { config: { ...((n?.data.config as object) ?? {}), [key]: value } });
  };

  function remove(nodeId: string) {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelected(null);
    touch();
  }

  function save() {
    start(async () => {
      const r = await saveWorkflowAction({ id, name, description, definition });
      if (!r.ok) return void toast.error(r.error);
      setDirty(false);
      toast.success("Saved.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="wf-name">Name</Label>
          <Input
            id="wf-name"
            value={name}
            maxLength={80}
            onChange={(e) => (setName(e.target.value), touch())}
          />
        </div>
        <div className="min-w-56 flex-[2]">
          <Label htmlFor="wf-desc">What it does</Label>
          <Input
            id="wf-desc"
            value={description}
            maxLength={300}
            onChange={(e) => (setDescription(e.target.value), touch())}
          />
        </div>
        <Button onClick={save} disabled={pending || !dirty}>
          <Save /> {dirty ? "Save changes" : "Saved"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div
          className="bg-card h-[28rem] overflow-hidden rounded-xl border lg:h-[34rem]"
          data-testid="flow-canvas"
        >
          <ReactFlow
            nodes={shown}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(c) => (
              onNodesChange(c),
              c.some((x) => x.type !== "select" && x.type !== "dimensions") && touch()
            )}
            onEdgesChange={(c) => (onEdgesChange(c), c.some((x) => x.type === "remove") && touch())}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            onBeforeDelete={async ({ nodes: ns }) => !ns.some((n) => n.type === "trigger")}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <div className="space-y-4">
          <section aria-label="Add a step" className="bg-card rounded-xl border p-3">
            <p className="mb-2 text-sm font-semibold">Add a step</p>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => add("condition")}>
                <GitBranch /> Condition
              </Button>
              {ACTION_TYPES.map((a) => (
                <Button key={a} size="sm" variant="outline" onClick={() => add("action", a)}>
                  {ACTION_LABEL[a]}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Drag from a dot on one step to another to connect them.
            </p>
          </section>

          <section aria-label="Step settings" className="bg-card rounded-xl border p-3">
            {!sel ? (
              <p className="text-muted-foreground text-sm">Select a step to edit it.</p>
            ) : (
              <Inspector
                node={sel}
                trigger={trigger}
                patch={patch}
                patchConfig={patchConfig}
                remove={remove}
              />
            )}
          </section>

          <section aria-label="Checks" className="bg-card rounded-xl border p-3">
            <p className="mb-1 text-sm font-semibold">Checks</p>
            {issues.length === 0 ? (
              <p className="text-success text-sm">Ready to turn on.</p>
            ) : (
              <ul className="text-destructive list-disc space-y-1 pl-4 text-sm">
                {issues.slice(0, 6).map((i, k) => (
                  <li key={k}>{i.message}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const sel = "bg-card h-10 w-full rounded-lg border px-3 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Inspector({
  node,
  trigger,
  patch,
  patchConfig,
  remove,
}: {
  node: FlowNode;
  trigger: TriggerKind;
  patch: (id: string, d: Partial<NData>) => void;
  patchConfig: (id: string, k: string, v: unknown) => void;
  remove: (id: string) => void;
}) {
  const d = node.data;
  const c = (d.config ?? {}) as Record<string, string>;
  const text = (key: string, label: string, multiline = false, placeholder?: string) => (
    <Field label={label}>
      {multiline ? (
        <textarea
          aria-label={label}
          className="bg-card min-h-20 w-full rounded-lg border px-3 py-2 text-sm"
          value={c[key] ?? ""}
          placeholder={placeholder}
          onChange={(e) => patchConfig(node.id, key, e.target.value)}
        />
      ) : (
        <Input
          aria-label={label}
          value={c[key] ?? ""}
          placeholder={placeholder}
          onChange={(e) => patchConfig(node.id, key, e.target.value)}
        />
      )}
    </Field>
  );
  const roleSelect = (key: string) => (
    <Field label="Assigned to">
      <select
        aria-label="Assigned to"
        className={sel}
        value={c[key] ?? "hr_admin"}
        onChange={(e) => patchConfig(node.id, key, e.target.value)}
      >
        <option value="hr_admin">HR admin</option>
        <option value="finance">Finance</option>
        <option value="super_admin">Super admin</option>
        <option value="manager">Manager</option>
      </select>
    </Field>
  );

  return (
    <div className="space-y-3">
      {node.type === "trigger" && (
        <Field label="When this happens">
          <select
            aria-label="Trigger"
            className={sel}
            value={String(d.kind)}
            onChange={(e) => patch(node.id, { kind: e.target.value })}
          >
            {TRIGGER_KINDS.map((k) => (
              <option key={k} value={k}>
                {TRIGGERS[k].label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {node.type === "condition" && (
        <>
          <Field label="Field">
            <select
              aria-label="Field"
              className={sel}
              value={String(d.field)}
              onChange={(e) => patch(node.id, { field: e.target.value })}
            >
              {TRIGGERS[trigger].fields.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Is">
            <select
              aria-label="Operator"
              className={sel}
              value={String(d.op)}
              onChange={(e) => patch(node.id, { op: e.target.value })}
            >
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Value">
            <Input
              aria-label="Value"
              value={String(d.value ?? "")}
              onChange={(e) => patch(node.id, { value: e.target.value })}
            />
          </Field>
        </>
      )}
      {node.type === "action" && (
        <>
          {d.action === "email" && (
            <>
              <Field label="Send to">
                <select
                  aria-label="Send to"
                  className={sel}
                  value={c.to ?? "hr"}
                  onChange={(e) => patchConfig(node.id, "to", e.target.value)}
                >
                  <option value="employee">The employee</option>
                  <option value="hr">HR admins</option>
                  <option value="custom">A specific address</option>
                </select>
              </Field>
              {c.to === "custom" && text("customEmail", "Email address")}
              {text("subject", "Subject")}
              {text("body", "Message", true)}
            </>
          )}
          {(d.action === "slack" || d.action === "teams") && (
            <>
              {text("url", "Incoming webhook URL", false, "https://…")}
              {text("message", "Message", true)}
            </>
          )}
          {d.action === "whatsapp" && (
            <>
              {text("to", "Phone with country code", false, "+91…")}
              {text("message", "Message", true)}
            </>
          )}
          {d.action === "webhook" && (
            <>
              {text("url", "URL", false, "https://…")}
              {text("message", "Note (optional)")}
            </>
          )}
          {d.action === "approval" && (
            <>
              {text("title", "What needs approval")}
              {roleSelect("assigneeRole")}
              <p className="text-muted-foreground text-xs">
                Pauses here until someone approves or rejects. Connect the “approved” and “rejected”
                dots to what happens next.
              </p>
            </>
          )}
          {d.action === "task" && (
            <>
              {text("title", "Task")}
              {text("detail", "Details (optional)", true)}
              {roleSelect("assigneeRole")}
            </>
          )}
          {d.action === "notify" && (
            <>
              <Field label="Notify">
                <select
                  aria-label="Notify"
                  className={sel}
                  value={c.audience ?? "hr"}
                  onChange={(e) => patchConfig(node.id, "audience", e.target.value)}
                >
                  <option value="employee">The employee</option>
                  <option value="hr">HR admins</option>
                </select>
              </Field>
              {text("title", "Title")}
              {text("body", "Details (optional)", true)}
            </>
          )}
          <p className="text-muted-foreground text-xs">
            Insert details with {"{{path}}"}:{" "}
            {TRIGGERS[trigger].fields.map((f) => `{{${f.path}}}`).join(", ")}
          </p>
        </>
      )}
      {node.type !== "trigger" && (
        <Button size="sm" variant="outline" onClick={() => remove(node.id)}>
          <Trash2 /> Remove step
        </Button>
      )}
    </div>
  );
}
