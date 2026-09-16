import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, Link, NavLink, Outlet } from "react-router-dom";
import { CunninghamProvider, MainLayout } from "@gouvfr-lasuite/ui-kit";
// ui-kit expose SON PROPRE CunninghamProvider, distinct de celui de cunningham-react
// (verifie : les deux composants ne sont pas identiques). Nos modales consomment le
// contexte de cunningham-react ; sans son fournisseur, elles levent
// « useCunningham must be used within a CunninghamProvider ». On imbrique donc les
// deux : ui-kit sert MainLayout, cunningham-react sert nos composants.
import { CunninghamProvider as CunninghamBase } from "@gouvfr-lasuite/cunningham-react";
import HomePage from "./components/HomePage";
import IakaLogo from "./components/IakaLogo";
import AccueilPage from "./features/accueil/AccueilPage";
import SaisiesApp from "./features/saisies/SaisiesApp";
import RgpApp from "./features/rgp/RgpApp";
import SyntheseApp from "./features/synthese/SyntheseApp";
import PvApp from "./features/pvtransport/PvApp";
import FrsApp from "./features/frs/FrsApp";
import CartePage from "./features/carte/CartePage";
import ArianeApp from "./features/ariane/ArianeApp";
import EvaluationApp from "./features/evaluation/EvaluationApp";
import { useSynthese } from "./features/synthese/syntheseStore";
import { useAriane } from "./features/ariane/arianeStore";
import { usePv } from "./features/pvtransport/pvStore";
import { useEvaluation } from "./features/evaluation/evaluationStore";
import { useRens } from "./features/rens/rensStore";
import { useRgp } from "./features/rgp/rgpStore";
import { useCarte } from "./features/carte/carteStore";
import { colors } from "./lib/uiTokens";

export default function App() {
  // Locale explicite : sans elle, les libelles natifs du systeme de design
  // sortent en anglais — « Yes » / « Cancel » dans les modales, entre autres.
  return (
    <CunninghamProvider theme="dsfr-light" currentLocale="fr-FR">
      <CunninghamBase theme="dsfr-light" currentLocale="fr-FR">
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="accueil" replace />} />
              <Route path="accueil" element={<AccueilPage />} />
              <Route path="analyse" element={<SyntheseApp />} />
              <Route path="pv-transport" element={<PvApp />} />
              <Route path="evaluation" element={<EvaluationApp />} />
              <Route path="saisies" element={<SaisiesApp />} />
              <Route path="carte" element={<CartePage />} />
              <Route path="rgp" element={<RgpApp />} />
              <Route path="frs" element={<FrsApp />} />
              <Route path="rens" element={<Navigate to="/app/frs?onglet=flux" replace />} />
              <Route path="qualite" element={<Navigate to="/app/frs?onglet=controle" replace />} />
              <Route path="ariane" element={<ArianeApp />} />
              <Route path="*" element={<Navigate to="/app/accueil" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </CunninghamBase>
    </CunninghamProvider>
  );
}

function Landing() {
  const navigate = useNavigate();
  return <HomePage onEnter={() => navigate("/app")} />;
}

type NavLeaf = { to: string; label: string; icon: string };
type NavGroupDef = { group: string; icon: string; items: NavLeaf[] };

// État du traitement (analyse / génération) d'une page, pour la pastille du menu.
type JobStatus = "idle" | "running" | "done" | "error";
function derive(running: boolean, error: unknown, done: boolean): JobStatus {
  if (running) return "running";
  if (error) return "error";
  if (done) return "done";
  return "idle";
}

// Statuts + SIGNATURE du résultat de chaque page à traitement long, indexés par route.
// Un seul point de lecture des stores (hooks appelés inconditionnellement). La signature
// change à chaque NOUVEAU résultat : elle sert à distinguer un résultat non lu d'un déjà vu,
// même pour RGP qui n'a pas d'état « en cours » pour ré-armer le badge.
function useNavStatuses(): { statuses: Record<string, JobStatus>; sigs: Record<string, string> } {
  const s = useSynthese();
  const a = useAriane();
  const p = usePv();
  const e = useEvaluation();
  const r = useRens();
  const g = useRgp();
  const c = useCarte();
  // RGP est un chat : pas d'état « en cours » attendu (pas d'orange). Seul le dernier
  // échange compte — vert s'il a une réponse, rouge s'il a échoué.
  const dernierRgp = g.echanges[g.echanges.length - 1];
  const rgp: JobStatus = dernierRgp?.error ? "error" : dernierRgp?.reply ? "done" : "idle";
  const carteData = c.data && c.data.features.length > 0 ? c.data : null;
  const statuses = {
    analyse: derive(s.loading, s.error, Boolean(s.html)),
    ariane: derive(a.running, a.error, Boolean(a.dossier)),
    "pv-transport": derive(p.loading, p.error, Boolean(p.resultat)),
    evaluation: derive(e.evaluationEnCours, e.erreur, Boolean(e.resultat)),
    frs: derive(r.pending, r.synthError, Boolean(r.markdown)),
    rgp,
    carte: derive(c.loading, c.error, Boolean(carteData)),
  };
  const sigs = {
    analyse: s.html ?? "",
    ariane: a.dossier ? `${a.dossier.affaire?.reference ?? ""}#${a.dossier.parties?.length ?? 0}` : "",
    "pv-transport": p.resultat ?? "",
    evaluation: e.resultat ? (e.resultat.pv ?? "x") : "",
    frs: r.markdown ?? "",
    rgp: dernierRgp?.reply || dernierRgp?.error ? String(dernierRgp.id) : "",
    carte: carteData ? `${carteData.features.length}:${carteData.features[0]?.properties?._layer ?? ""}` : "",
  };
  return { statuses, sigs };
}

// État le plus prioritaire d'un groupe (en cours > échec > terminé > rien) pour l'en-tête replié.
function agregerStatuts(statuts: (JobStatus | undefined)[]): JobStatus {
  if (statuts.includes("running")) return "running";
  if (statuts.includes("error")) return "error";
  if (statuts.includes("done")) return "done";
  return "idle";
}

const STATUT_STYLE: Record<Exclude<JobStatus, "idle">, { couleur: string; titre: string }> = {
  running: { couleur: colors.running, titre: "Traitement en cours" },
  done: { couleur: colors.ok, titre: "Traitement terminé" },
  error: { couleur: colors.error, titre: "Traitement en échec" },
};

// Pastille de notification posée sur le coin haut-droit de l'icône de la page (anneau
// blanc pour la détacher du glyphe). À placer dans un conteneur en position relative.
function StatusDot({ status }: { status?: JobStatus }) {
  if (!status || status === "idle") return null;
  const { couleur, titre } = STATUT_STYLE[status];
  return (
    <span
      role="status"
      aria-label={titre}
      title={titre}
      className={status === "running" ? "nav-dot-running" : undefined}
      style={{
        position: "absolute", top: -3, right: -4,
        width: 9, height: 9, borderRadius: "50%", background: couleur,
        border: "2px solid var(--c--globals--colors--greyscale-000, #fff)", boxSizing: "content-box",
        ...(status === "running" ? { animation: "nav-dot-pulse 1.2s ease-in-out infinite" } : null),
      }}
    />
  );
}

// Icône Material avec sa pastille d'état en surimpression (coin haut-droit).
function IconWithStatus({ icon, status }: { icon: string; status?: JobStatus }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <span className="material-icons" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <StatusDot status={status} />
    </span>
  );
}

const NAV: (NavLeaf | NavGroupDef)[] = [
  { to: "accueil", label: "Accueil", icon: "home" },
  {
    group: "Rédaction procédure",
    icon: "edit_note",
    items: [
      { to: "analyse", label: "Analyse", icon: "summarize" },
      { to: "ariane", label: "Ariane", icon: "account_tree" },
      { to: "pv-transport", label: "PV transport", icon: "description" },
      { to: "saisies", label: "Perquisitions", icon: "search" },
      { to: "evaluation", label: "Évaluation des avoirs", icon: "savings" },
      { to: "rgp", label: "Assistant personnel - RGP", icon: "support_agent" },
    ],
  },
  {
    group: "Sécurité publique",
    icon: "shield",
    items: [
      { to: "carte", label: "Carte BDSP", icon: "map" },
      { to: "frs", label: "Fiches de renseignement", icon: "policy" },
    ],
  },
];

function AppLayout() {
  return (
    <MainLayout
      icon={
        <Link
          to="/"
          aria-label="Retour à l'accueil"
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
        >
          <IakaLogo size="2.25rem" />
          <span style={{ fontWeight: 700, color: colors.brand, fontSize: 18, lineHeight: 1.2 }}>
            Expérimentation IAKA DGGN
          </span>
        </Link>
      }
      leftPanelContent={<AppNav />}
      leftPanelFooter={
        <div style={{ padding: 8, textAlign: "center" }}>
          <span
            title="Version de l'application"
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 10px", borderRadius: 999,
              border: "1px solid var(--c--globals--colors--brand-200, #cacafb)",
              background: `var(--c--globals--colors--brand-050, ${colors.brand050})`,
              color: colors.brand, fontSize: 12, fontWeight: 600, lineHeight: 1.4,
              fontVariantNumeric: "tabular-nums", letterSpacing: 0.2,
            }}
          >
            <span className="material-icons" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>sell</span>
            v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}
          </span>
        </div>
      }
    >
      <div className="app-container" style={{ height: "100%", minWidth: 0 }}>
        <Outlet />
      </div>
    </MainLayout>
  );
}

function NavItem({ to, label, icon, indent = false, status }: NavLeaf & { indent?: boolean; status?: JobStatus }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        paddingLeft: indent ? 34 : 12, borderRadius: 8,
        border: "1px solid transparent", textDecoration: "none", textAlign: "left", fontSize: 14,
        fontWeight: isActive ? 700 : 500,
        background: isActive ? `var(--c--globals--colors--brand-050, ${colors.brand050})` : "transparent",
        color: isActive ? colors.brand : "inherit",
      })}
    >
      <IconWithStatus icon={icon} status={status} />
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
    </NavLink>
  );
}

function NavGroup({ label, icon, items, statuses }: { label: string; icon: string; items: NavLeaf[]; statuses: Record<string, JobStatus> }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
          borderRadius: 8, border: "1px solid transparent", background: "transparent",
          cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: 600, color: "inherit",
        }}
      >
        {/* Replié : la pastille de la page concernée serait masquée → on remonte l'état
            le plus prioritaire du groupe sur l'icône de l'en-tête pour ne pas perdre le signal. */}
        <IconWithStatus icon={icon} status={open ? undefined : agregerStatuts(items.map((c) => statuses[c.to]))} />
        <span style={{ flex: 1 }}>{label}</span>
        <span className="material-icons" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
          {open ? "expand_more" : "chevron_right"}
        </span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {items.map((c) => <NavItem key={c.to} {...c} indent status={statuses[c.to]} />)}
        </div>
      )}
    </div>
  );
}

function AppNav() {
  const { statuses, sigs } = useNavStatuses();
  const location = useLocation();
  const current = location.pathname.split("/").pop() ?? "";

  // Le vert (résultat prêt) est une notification « non lue » : `seen[route]` mémorise la
  // signature du dernier résultat consulté. Visiter la page enregistre sa signature courante
  // (badge masqué) ; un nouveau résultat change la signature → le badge se ré-arme tout seul,
  // y compris pour RGP (qui n'a pas d'état « en cours »).
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => {
    setSeen((prev) =>
      statuses[current] === "done" && prev[current] !== sigs[current]
        ? { ...prev, [current]: sigs[current] }
        : prev
    );
  }, [statuses, current, sigs]);

  // Statuts effectifs : un « done » dont la signature a déjà été vue retombe sur « idle ».
  const eff: Record<string, JobStatus> = {};
  for (const [route, st] of Object.entries(statuses)) eff[route] = st === "done" && seen[route] === sigs[route] ? "idle" : st;

  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
      {NAV.map((it) =>
        "group" in it
          ? <NavGroup key={it.group} label={it.group} icon={it.icon} items={it.items} statuses={eff} />
          : <NavItem key={it.to} {...it} status={eff[it.to]} />
      )}
    </nav>
  );
}
