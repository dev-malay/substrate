export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export function notFound(message: string): Response {
  return Response.json({ error: message }, { status: 404 });
}

export function unprocessable(message: string): Response {
  return Response.json({ error: message }, { status: 422 });
}

export function serverError(message = "internal error"): Response {
  return Response.json({ error: message }, { status: 500 });
}

export function noLeader(): Response {
  return Response.json({ error: "no leader" }, { status: 503 });
}

export function redirectToLeader(leaderUrl: string, path: string): Response {
  return new Response(null, {
    status: 307,
    headers: { location: leaderUrl + path },
  });
}

export function queueFull(): Response {
  return Response.json({ error: "queue full" }, { status: 503 });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
