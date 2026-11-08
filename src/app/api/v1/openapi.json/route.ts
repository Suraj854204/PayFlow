import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/api/openapi";

/** Public: the spec describes the API, not anyone's data. */
export function GET(req: Request) {
  return NextResponse.json(openApiSpec(new URL(req.url).origin));
}
