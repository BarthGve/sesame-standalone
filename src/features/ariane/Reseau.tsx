import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { Dossier, Role } from "./arianeApi";
import { buildForceData, groupByRole, ROLE_LABELS, type GraphNode } from "./graph";

// Réseau relationnel avec react-force-graph : rendu physique (nœuds repoussés,
// liens élastiques), zoom/pan à la molette, drag des nœuds. Deux apports sur la
// version cytoscape : survol d'un nœud → voisins en surbrillance (le reste
// estompé), et un panneau de filtres par rôle ET par personne (les nœuds
// décochés — et leurs liens — disparaissent du graphe).

type FGNode = GraphNode & { x?: number; y?: number };
type FGLink = { source: FGNode | string; target: FGNode | string; label: string; cotes: string[] };

const idOf = (v: FGNode | string) => (typeof v === "string" ? v : v.id);

export default function Reseau({ dossier, onSelectCotes }: { dossier: Dossier; onSelectCotes: (cotes: string[]) => void }) {
  const contRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  // Personnes masquées (décochées). Par défaut toutes visibles.
  const [caches, setCaches] = useState<Set<string>>(new Set());

  // Suit la taille du conteneur : le canvas de force-graph a besoin d'une taille
  // explicite (il ne s'étire pas en CSS comme un SVG).
  useEffect(() => {
    if (!contRef.current) return;
    const el = contRef.current;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const base = useMemo(() => buildForceData(dossier), [dossier]);
  const groups = useMemo(() => groupByRole(dossier.parties), [dossier.parties]);

  // Filtrage : on retire les nœuds masqués et toute arête qui les touche. Un
  // nouvel objet {nodes,links} à chaque changement de filtre (react-force-graph
  // ré-simule à partir des positions courantes, la transition reste douce).
  const data = useMemo(() => {
    const nodes = base.nodes.filter((n) => !caches.has(n.id));
    const visibles = new Set(nodes.map((n) => n.id));
    const links = base.links.filter((l) => visibles.has(idOf(l.source as any)) && visibles.has(idOf(l.target as any)));
    return { nodes, links };
  }, [base, caches]);

  // Voisins du nœud survolé (pour la surbrillance). Calculé sur les liens visibles.
  const voisins = useMemo(() => {
    if (!hovered) return null;
    const s = new Set<string>([hovered]);
    for (const l of data.links as FGLink[]) {
      const a = idOf(l.source), b = idOf(l.target);
      if (a === hovered) s.add(b);
      if (b === hovered) s.add(a);
    }
    return s;
  }, [hovered, data.links]);

  function toggle(id: string) {
    setCaches((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleRole(parties: { id: string }[]) {
    const ids = parties.map((p) => p.id);
    const tousMasques = ids.every((id) => caches.has(id));
    setCaches((prev) => {
      const next = new Set(prev);
      // Si tous masqués → on ré-affiche le groupe ; sinon on masque tout le groupe.
      ids.forEach((id) => (tousMasques ? next.delete(id) : next.add(id)));
      return next;
    });
  }
  const toutAfficher = () => setCaches(new Set());

  const drawNode = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const estompe = voisins != null && !voisins.has(node.id);
      const r = 6;
      ctx.globalAlpha = estompe ? 0.15 : 1;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();
      if (node.id === hovered) {
        ctx.lineWidth = 2 / scale;
        ctx.strokeStyle = "#161616";
        ctx.stroke();
      }
      const font = 11 / scale;
      ctx.font = `${font}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#161616";
      ctx.fillText(node.nom, node.x!, node.y! + r + 1);
      ctx.globalAlpha = 1;
    },
    [voisins, hovered],
  );

  // Libellé du type de relation dessiné au MILIEU du lien (react-force-graph
  // n'affiche `linkLabel` qu'en infobulle au survol). Estompé si hors voisinage.
  const drawLink = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, scale: number) => {
      const s = link.source, t = link.target;
      if (!s || !t || typeof s.x !== "number" || typeof t.x !== "number") return;
      if (!link.label) return;
      const estompe = voisins != null && !(voisins.has(idOf(s)) && voisins.has(idOf(t)));
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      const font = 9 / scale;
      ctx.font = `${font}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(link.label).width;
      const padX = 2 / scale, h = font + 2 / scale;
      ctx.globalAlpha = estompe ? 0.12 : 0.95;
      ctx.fillStyle = "#fff"; // fond lisible par-dessus le trait
      ctx.fillRect(mx - w / 2 - padX, my - h / 2, w + padX * 2, h);
      ctx.fillStyle = "#5b5b6b";
      ctx.fillText(link.label, mx, my);
      ctx.globalAlpha = 1;
    },
    [voisins],
  );

  const nbMasques = caches.size;

  return (
    <div style={{ display: "flex", gap: 12, height: "clamp(480px, 74vh, 920px)" }}>
      {/* Panneau de filtres */}
      <div style={{ width: 220, flexShrink: 0, overflowY: "auto", border: "1px solid #e5e5e5", borderRadius: 6, padding: "10px 12px", background: "#fff", fontSize: 13 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <strong style={{ fontSize: 12.5 }}>Afficher</strong>
          {nbMasques > 0 && (
            <button type="button" onClick={toutAfficher} style={{ border: "none", background: "none", color: "#000091", cursor: "pointer", fontSize: 12, textDecoration: "underline", padding: 0 }}>
              Tout ({nbMasques} masqué{nbMasques > 1 ? "s" : ""})
            </button>
          )}
        </div>
        {groups.map((g) => {
          const tousMasques = g.parties.every((p) => caches.has(p.id));
          return (
            <div key={g.role} style={{ marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => toggleRole(g.parties)}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", border: "none", background: "none", cursor: "pointer", padding: "2px 0", textAlign: "left", fontWeight: 700, fontSize: 12, color: tousMasques ? "#9a9a9a" : "#161616" }}
              >
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: g.color, display: "inline-block", opacity: tousMasques ? 0.3 : 1 }} />
                {ROLE_LABELS[g.role]} ({g.parties.length})
              </button>
              <ul style={{ listStyle: "none", margin: "2px 0 0", padding: 0 }}>
                {g.parties.map((p) => (
                  <li key={p.id}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0 2px 16px", cursor: "pointer", color: caches.has(p.id) ? "#9a9a9a" : "#161616" }}>
                      <input type="checkbox" checked={!caches.has(p.id)} onChange={() => toggle(p.id)} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Graphe */}
      <div ref={contRef} data-reseau-graph style={{ flex: 1, minWidth: 0, border: "1px solid #e5e5e5", borderRadius: 6, background: "#fafafa", overflow: "hidden" }}>
        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={data as any}
          nodeId="id"
          nodeLabel={(n: any) => `${n.nom}${(n.role as string) ? ` — ${ROLE_LABELS[n.role as Role]}` : ""}`}
          nodeCanvasObject={drawNode as any}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={(l: any) => (voisins != null && !(voisins.has(idOf(l.source)) && voisins.has(idOf(l.target))) ? "#eee" : "#bbb")}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={drawLink as any}
          linkLabel={(l: any) => l.label}
          onNodeHover={(n: any) => setHovered(n ? n.id : null)}
          onNodeDragEnd={(n: any) => { n.fx = n.x; n.fy = n.y; }}
          onLinkClick={(l: any) => onSelectCotes((l.cotes as string[]) ?? [])}
          cooldownTicks={80}
        />
      </div>
    </div>
  );
}
