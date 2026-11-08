import Link from "next/link";
import { Network } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/context";
import { withTenant } from "@/lib/db";
import { listOrgChart } from "@/lib/queries";

export const metadata = { title: "Org chart" };

type Person = Awaited<ReturnType<typeof listOrgChart>>[number];
interface Node extends Person {
  children: Node[];
}

function buildTree(people: Person[]): Node[] {
  const nodes = new Map<string, Node>(people.map((p) => [p.id, { ...p, children: [] }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) {
    const parent = n.managerId ? nodes.get(n.managerId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n); // no manager, or manager has exited
  }
  return roots;
}

function Branch({ node, depth, seen }: { node: Node; depth: number; seen: Set<string> }) {
  if (seen.has(node.id) || depth > 30) return null;
  seen.add(node.id);
  return (
    <li>
      <Link
        href={`/employees/${node.id}`}
        className="bg-card hover:border-primary inline-block rounded-xl border px-3 py-2 text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <span className="block font-medium">{node.name}</span>
        <span className="text-muted-foreground block text-xs">
          {[node.designation, node.department].filter(Boolean).join(" · ") || "—"}
        </span>
      </Link>
      {node.children.length > 0 && (
        <ul className="border-border mt-3 ml-4 space-y-3 border-l pl-6">
          {node.children.map((c) => (
            <Branch key={c.id} node={c} depth={depth + 1} seen={seen} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function OrgChartPage() {
  const ctx = await requirePagePermission("employees:read");
  const people = await withTenant(ctx.organizationId, (tx) => listOrgChart(tx, ctx.organizationId));
  const roots = buildTree(people);
  const seen = new Set<string>();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Org chart</h1>
        <p className="text-muted-foreground text-sm">
          {people.length} people. Set who someone reports to on their profile.
        </p>
      </div>
      {people.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border py-16 text-center">
          <Network className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            Add employees to see your organisation take shape.
          </p>
        </div>
      ) : (
        <ul className="space-y-3 overflow-x-auto pb-4">
          {roots.map((r) => (
            <Branch key={r.id} node={r} depth={0} seen={seen} />
          ))}
        </ul>
      )}
    </div>
  );
}
