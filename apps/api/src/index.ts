const port = Number(process.env.PORT || 3000);

Bun.serve({
  port,
  fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log("server running on " + port);
