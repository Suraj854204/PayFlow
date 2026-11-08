import type { TriggerKind, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@/lib/db/schema";
import { ACTION_CONFIG, type ActionType } from "./model";
import type { z } from "zod";

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  trigger: TriggerKind;
  build: () => WorkflowDefinition;
}

type Cfg<A extends ActionType> = z.input<(typeof ACTION_CONFIG)[A]>;
const X = 260;
const Y = 130;

/** Small builder so each template reads like the flow it draws. */
class B {
  nodes: WorkflowNode[] = [];
  edges: WorkflowEdge[] = [];
  constructor(kind: TriggerKind) {
    this.nodes.push({ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind } });
  }
  action<A extends ActionType>(id: string, action: A, config: Cfg<A>, col: number, row: number) {
    this.nodes.push({
      id,
      type: "action",
      position: { x: col * X, y: row * Y },
      data: { action, config },
    });
    return id;
  }
  condition(
    id: string,
    field: string,
    op: string,
    value: string | number,
    col: number,
    row: number,
  ) {
    this.nodes.push({
      id,
      type: "condition",
      position: { x: col * X, y: row * Y },
      data: { field, op, value },
    });
    return id;
  }
  link(from: string, to: string, handle?: string) {
    this.edges.push({
      id: `${from}-${handle ?? "next"}-${to}`,
      source: from,
      target: to,
      sourceHandle: handle ?? null,
    });
  }
  done(): WorkflowDefinition {
    return { nodes: this.nodes, edges: this.edges };
  }
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    key: "long-leave-approval",
    name: "Long leave needs HR sign-off",
    description:
      "Leave of more than 3 days asks HR to approve, then tells the employee what happened.",
    trigger: "leave.applied",
    build: () => {
      const b = new B("leave.applied");
      b.condition("c", "leave.days", "gt", 3, 1, 0);
      b.action(
        "a",
        "approval",
        { title: "Review {{employee.name}}'s {{leave.days}}-day leave", assigneeRole: "hr_admin" },
        2,
        0,
      );
      b.action(
        "ok",
        "email",
        {
          to: "employee",
          subject: "Your long leave was reviewed",
          body: "Hi {{employee.name}}, HR approved your {{leave.type}} from {{leave.from}}.",
        },
        3,
        -1,
      );
      b.action(
        "no",
        "email",
        {
          to: "employee",
          subject: "About your leave request",
          body: "Hi {{employee.name}}, HR would like to talk about your leave request before approving it.",
        },
        3,
        1,
      );
      b.link("t", "c");
      b.link("c", "a", "true");
      b.link("a", "ok", "approved");
      b.link("a", "no", "rejected");
      return b.done();
    },
  },
  {
    key: "leave-to-teams",
    name: "Tell the team channel about leave",
    description: "Posts every leave request to a Microsoft Teams channel.",
    trigger: "leave.applied",
    build: () => {
      const b = new B("leave.applied");
      b.action(
        "a",
        "teams",
        {
          url: "https://example.webhook.office.com/replace-me",
          message:
            "{{employee.name}} ({{employee.department}}) applied for {{leave.days}} day(s) of {{leave.type}} from {{leave.from}}.",
        },
        1,
        0,
      );
      b.link("t", "a");
      return b.done();
    },
  },
  {
    key: "payroll-approved-notify",
    name: "Payroll approved: tell Slack and HR",
    description: "When payroll is approved, post a summary to Slack and email HR.",
    trigger: "payroll.approved",
    build: () => {
      const b = new B("payroll.approved");
      b.action(
        "s",
        "slack",
        {
          url: "https://hooks.slack.com/services/replace-me",
          message:
            "{{run.monthLabel}} payroll approved: {{run.employees}} employees, net {{run.totalNetInr}}.",
        },
        1,
        -0.5,
      );
      b.action(
        "e",
        "email",
        {
          to: "hr",
          subject: "{{run.monthLabel}} payroll approved",
          body: "Payroll for {{run.monthLabel}} was approved: {{run.employees}} employees, total net pay {{run.totalNetInr}}.",
        },
        1,
        0.5,
      );
      b.link("t", "s");
      b.link("t", "e");
      return b.done();
    },
  },
  {
    key: "payroll-to-accounting",
    name: "Payroll approved: push to accounting",
    description: "Sends a signed webhook to your accounting system when payroll is approved.",
    trigger: "payroll.approved",
    build: () => {
      const b = new B("payroll.approved");
      b.action(
        "w",
        "webhook",
        { url: "https://example.com/replace-me", message: "payroll approved" },
        1,
        0,
      );
      b.link("t", "w");
      return b.done();
    },
  },
  {
    key: "new-joiner-welcome",
    name: "New joiner welcome",
    description: "Welcome email, then tasks for HR to collect documents and prepare equipment.",
    trigger: "employee.joined",
    build: () => {
      const b = new B("employee.joined");
      b.action(
        "e",
        "email",
        {
          to: "employee",
          subject: "Welcome to the team, {{employee.name}}!",
          body: "We are glad you are joining as {{employee.designation}} on {{employee.joinDate}}. HR will be in touch about your first day.",
        },
        1,
        0,
      );
      b.action(
        "t1",
        "task",
        {
          title: "Collect documents from {{employee.name}}",
          assigneeRole: "hr_admin",
          detail: "PAN, Aadhaar, bank proof.",
        },
        2,
        -0.5,
      );
      b.action(
        "t2",
        "task",
        { title: "Prepare laptop and access for {{employee.name}}", assigneeRole: "hr_admin" },
        2,
        0.5,
      );
      b.link("t", "e");
      b.link("e", "t1");
      b.link("e", "t2");
      return b.done();
    },
  },
  {
    key: "new-joiner-announce",
    name: "Announce new joiners and provision IT",
    description: "Posts a welcome to Slack and calls your IT provisioning webhook.",
    trigger: "employee.joined",
    build: () => {
      const b = new B("employee.joined");
      b.action(
        "s",
        "slack",
        {
          url: "https://hooks.slack.com/services/replace-me",
          message:
            "Please welcome {{employee.name}}, joining {{employee.department}} as {{employee.designation}}!",
        },
        1,
        -0.5,
      );
      b.action("w", "webhook", { url: "https://example.com/it/provision" }, 1, 0.5);
      b.link("t", "s");
      b.link("t", "w");
      return b.done();
    },
  },
  {
    key: "compliance-reminder",
    name: "Compliance deadline reminder",
    description: "Emails HR and posts to Slack when a statutory deadline is near.",
    trigger: "deadline.near",
    build: () => {
      const b = new B("deadline.near");
      b.action(
        "e",
        "email",
        {
          to: "hr",
          subject: "Due soon: {{deadline.label}}",
          body: "{{deadline.label}} is due on {{deadline.dueDate}} ({{deadline.daysLeft}} day(s) left).",
        },
        1,
        -0.5,
      );
      b.action(
        "s",
        "slack",
        {
          url: "https://hooks.slack.com/services/replace-me",
          message: "{{deadline.label}} due {{deadline.dueDate}}",
        },
        1,
        0.5,
      );
      b.link("t", "e");
      b.link("t", "s");
      return b.done();
    },
  },
  {
    key: "deadline-escalation",
    name: "Escalate deadlines due within a day",
    description:
      "If a deadline is one day away or less, create a task for Finance and send a WhatsApp message.",
    trigger: "deadline.near",
    build: () => {
      const b = new B("deadline.near");
      b.condition("c", "deadline.daysLeft", "lte", 1, 1, 0);
      b.action(
        "k",
        "task",
        { title: "Urgent: {{deadline.label}} due {{deadline.dueDate}}", assigneeRole: "finance" },
        2,
        -0.5,
      );
      b.action(
        "w",
        "whatsapp",
        { to: "+910000000000", message: "Urgent: {{deadline.label}} is due {{deadline.dueDate}}." },
        2,
        0.5,
      );
      b.link("t", "c");
      b.link("c", "k", "true");
      b.link("c", "w", "true");
      return b.done();
    },
  },
];
