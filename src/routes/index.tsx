import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { parseM3U, type Channel } from "@/lib/m3u";
import { Player } from "@/components/Player";
import { Tv, Radio, Search } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Sportlink — Live Sports Streaming" },
      {
        name: "description",
        content: "Sportlink by Sayan10 — Watch live FIFA and ICC sports streams in one place.",
      },
    ],
  }),
});

const PLAYLISTS = [
  {
    id: "fifa",
    label: "FIFA",
    icon: Tv,
    url: "https://raw.githubusercontent.com/srhady/fifaplus/refs/heads/main/fifa_live.m3u",
  },
  {
    id: "icc",
    label: "ICC",
    icon: Radio,
    url: "https://raw.githubusercontent.com/doctor-8trange/nexphi0/refs/heads/main/data/icc.m3u",
  },
];

function proxied(url: string) {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

function Index() {
  const [channels, setChannels] = useState<Record<string, Channel[]>>({});
  const [activeTab, setActiveTab] = useState(PLAYLISTS[0].id);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result: Record<string, Channel[]> = {};
      await Promise.all(
        PLAYLISTS.map(async (p) => {
          try {
            // Try direct first, fall back to proxy
            let text: string;
            try {
              const res = await fetch(p.url);
              if (!res.ok) throw new Error(String(res.status));
              text = await res.text();
            } catch {
              const res = await fetch(proxied(p.url));
              text = await res.text();
            }
            result[p.id] = parseM3U(text);
          } catch (e) {
            console.error("Failed playlist", p.id, e);
            result[p.id] = [];
          }
        }),
      );
      if (!cancelled) {
        setChannels(result);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const list = channels[activeTab] || [];
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, activeTab, query]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 backdrop-blur-md sticky top-0 z-20 bg-background/80">
        <div className="mx-auto max-w-7xl px-4 py-5 flex items-center justify-between">
          <div>
            <h1
              className="text-3xl md:text-4xl font-black tracking-tight bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-hero)" }}
            >
              Sportlink
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5 tracking-widest uppercase">
              Sayan10
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2 w-72">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels…"
              className="bg-transparent outline-none text-sm flex-1"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 grid lg:grid-cols-[1fr_360px] gap-6">
        <section>
          <div
            className="aspect-video rounded-2xl overflow-hidden border border-border"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            {selected ? (
              <Player channel={selected} />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-card">
                <Tv className="w-16 h-16 text-primary mb-3" />
                <p className="text-lg font-semibold">Select a channel to start streaming</p>
                <p className="text-sm text-muted-foreground">
                  Live sports from FIFA & ICC playlists
                </p>
              </div>
            )}
          </div>
          {selected && (
            <div className="mt-4 flex items-center gap-3">
              {selected.logo && (
                <img
                  src={selected.logo}
                  alt={selected.name}
                  className="w-12 h-12 rounded-lg object-contain bg-card border border-border p-1"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
              )}
              <div>
                <h2 className="text-xl font-bold">{selected.name}</h2>
                {selected.group && (
                  <p className="text-xs text-muted-foreground">{selected.group}</p>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="lg:max-h-[calc(100vh-7rem)] lg:sticky lg:top-24 flex flex-col">
          <div className="flex gap-2 mb-3">
            {PLAYLISTS.map((p) => {
              const Icon = p.icon;
              const active = activeTab === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveTab(p.id)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {p.label}
                  <span className="text-xs opacity-70">
                    ({channels[p.id]?.length ?? 0})
                  </span>
                </button>
              );
            })}
          </div>

          <div className="md:hidden mb-3 flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels…"
              className="bg-transparent outline-none text-sm flex-1"
            />
          </div>

          <div className="flex-1 overflow-y-auto rounded-2xl border border-border bg-card/50 divide-y divide-border">
            {loading && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Loading playlists…
              </div>
            )}
            {!loading && visible.length === 0 && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No channels found.
              </div>
            )}
            {visible.map((ch) => {
              const active = selected?.url === ch.url;
              return (
                <button
                  key={ch.id}
                  onClick={() => setSelected(ch)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60 transition-colors ${
                    active ? "bg-secondary" : ""
                  }`}
                >
                  {ch.logo ? (
                    <img
                      src={ch.logo}
                      alt=""
                      className="w-10 h-10 rounded-md object-contain bg-background border border-border p-0.5 flex-shrink-0"
                      onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-background border border-border flex items-center justify-center flex-shrink-0">
                      <Tv className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{ch.name}</p>
                    {ch.group && (
                      <p className="text-xs text-muted-foreground truncate">{ch.group}</p>
                    )}
                  </div>
                  {active && (
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      </main>

      <footer className="border-t border-border/50 mt-8">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted-foreground text-center">
          Sportlink · Built by Sayan10 · Streams proxied via edge worker
        </div>
      </footer>
    </div>
  );
}

