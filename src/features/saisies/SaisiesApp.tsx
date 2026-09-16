import { useEffect, useRef, useState } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import { searchAdresse, type AdresseSuggestion } from "./ban";
import { CATEGORIES, SOUS_TYPES_TRANSPORT } from "./catalogue";
import { recomputeChamps } from "./objetChamps";
import { type ApiObjet, photoUrl } from "./perquisitionApi";
import PvPerquisition from "./PvPerquisition";
import UnaPicker from "./UnaPicker";
import UnaScreen from "./UnaScreen";
import {
  objetComplet,
  type CategorieCode,
  type Champ,
  type ObjetSaisi,
  type Perquisition,
  type SituationScelle,
  type SousTypeTransport,
} from "./types";
import {
  useSaisies, pickUna, backToHome, backToUna, beginCreate, cancelCreate, submitSetup,
  startEditPerq, submitEditPerq, openExisting, setShowPv, startEditObjet, setEditObjetDraft,
  cancelEditObjet, saveObjetEdit, deleteObjetEdit, validerTout, addFiles, addDemo, analyze,
  patchItem, removeItem,
} from "./saisiesStore";
import { colors, cardStyle, fieldStyle, labelStyle } from "../../lib/uiTokens";

/* ---------------- styles partagés (tokens DSFR / lib) ---------------- */
const BRAND = colors.brand;
const BRAND_050 = colors.brand050;
const OK = colors.ok;
const TODO = colors.warn;
const ERR = colors.error;
const BORDER = colors.border;
const MUTED = colors.muted;

const card = cardStyle;
const field = fieldStyle;
const label = labelStyle;

/* ================================================================= */
export default function SaisiesApp() {
  const s = useSaisies();
  const { screen, selectedUna, perquisition, editingPerq, perqMode, opened, editingObjet, showPv, creating, saveState } = s;

  if (screen === "home") {
    return <UnaPicker onPick={pickUna} />;
  }
  if (screen === "una" && selectedUna) {
    return (
      <UnaScreen
        una={selectedUna}
        onBack={backToHome}
        onNew={beginCreate}
        onOpen={openExisting}
        creating={creating}
        form={
          creating ? (
            <SetupScreen
              inline
              una={selectedUna.una}
              communePrefill={{ nom: selectedUna.commune_libelle, insee: selectedUna.commune, codePostal: selectedUna.commune_code_postal }}
              initial={null}
              onBack={cancelCreate}
              onSubmit={submitSetup}
            />
          ) : null
        }
      />
    );
  }

  if (perqMode === "create" && (!perquisition || editingPerq)) {
    return (
      <SetupScreen
        una={selectedUna?.una ?? ""}
        communePrefill={selectedUna ? { nom: selectedUna.commune_libelle, insee: selectedUna.commune, codePostal: selectedUna.commune_code_postal } : undefined}
        initial={perquisition}
        onBack={backToUna}
        onSubmit={submitEditPerq}
      />
    );
  }

  const enConsult = perqMode === "consult" && opened;
  const perquisitionCourante: Perquisition | null = enConsult
    ? {
        adresse: opened!.adresse,
        commune: opened!.commune_libelle ?? "",
        codePostal: opened!.code_postal ?? "",
        dateDebut: opened!.date_debut ?? "",
        dateFin: opened!.date_fin ?? "",
        typeLieu: (opened!.type_lieu as Perquisition["typeLieu"]) ?? "AUTRE",
        perquisitionne: opened!.perquisitionne ?? "",
        opj: opened!.opj ?? "",
        una: opened!.una,
        intervenants: opened!.intervenants ?? [],
        pieces: opened!.pieces ?? [],
      }
    : perquisition;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", minWidth: 0 }}>
      <PerqSidebar
        perquisition={perquisitionCourante!}
        objetsExistants={enConsult ? opened!.objets : undefined}
        onEditPerq={enConsult ? undefined : startEditPerq}
        onEditObjet={enConsult ? startEditObjet : undefined}
        onBackToUna={backToUna}
        onGenererPv={enConsult ? () => setShowPv(true) : undefined}
      />
      <div style={{ padding: "26px 30px 40px", overflowY: "auto", width: "100%", maxWidth: 1040, margin: "0 auto" }}>
        {showPv && opened ? (
          <PvPerquisition perquisition={opened} onClose={() => setShowPv(false)} />
        ) : editingObjet ? (
          <ObjetEditor
            key={editingObjet.objetId}
            draft={editingObjet.draft}
            perquisition={perquisitionCourante!}
            saveState={saveState}
            onChange={setEditObjetDraft}
            onSave={saveObjetEdit}
            onCancel={cancelEditObjet}
            onDelete={deleteObjetEdit}
          />
        ) : (
          <BatchIdentify perquisition={perquisitionCourante!} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Sidebar contexte perquisition ---------------- */
function PerqSidebar({
  perquisition,
  objetsExistants,
  onEditPerq,
  onEditObjet,
  onBackToUna,
  onGenererPv,
}: {
  perquisition: Perquisition;
  objetsExistants?: ApiObjet[];
  onEditPerq?: () => void;
  onEditObjet?: (o: ApiObjet) => void;
  onBackToUna: () => void;
  onGenererPv?: () => void;
}) {
  return (
    <aside style={{ background: "#fff", borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
      <div style={{ padding: "18px 18px 8px" }}>
        <Button variant="secondary" size="small" onClick={onBackToUna} icon={<Icon name="arrow_back" size={15} />}>Perquisitions de l'UNA</Button>
        <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", color: MUTED, marginTop: 14 }}>Perquisition</div>
        <div style={{ fontWeight: 700, marginTop: 2 }}>{perquisition.adresse}</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{perquisition.perquisitionne} · {perquisition.commune}</div>
        {onEditPerq && <Button variant="secondary" size="small" onClick={onEditPerq} icon={<Icon name="edit" size={15} />} style={{ marginTop: 8 }}>Modifier la perquisition</Button>}
        {onGenererPv && <Button size="small" fullWidth onClick={onGenererPv} icon={<Icon name="description" size={16} />} style={{ marginTop: 10 }}>Générer le PV</Button>}
      </div>
      {objetsExistants && objetsExistants.length > 0 && (
        <div style={{ padding: "6px 12px 16px" }}>
          <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em", color: MUTED, padding: "6px 6px" }}>Objets enregistrés ({objetsExistants.length})</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {objetsExistants.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => onEditObjet?.(o)}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#f6f6fb", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Icon name={CATEGORIES[o.categorie as keyof typeof CATEGORIES]?.icon ?? "inventory_2"} size={16} color={BRAND} />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{CATEGORIES[o.categorie as keyof typeof CATEGORIES]?.libelle ?? o.categorie}{o.numero_scelle ? ` · ${o.numero_scelle}` : ""}</span>
                  <Icon name="edit" size={15} color={MUTED} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

/* ---------------- Vue d'édition d'un objet enregistré ---------------- */
function ObjetEditor({
  draft,
  perquisition,
  saveState,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: ObjetSaisi;
  perquisition: Perquisition;
  saveState: { status: "idle" | "saving" | "ok" | "err"; msg?: string; id?: number };
  onChange: (o: ObjetSaisi) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const complet = objetComplet(draft);
  const [confirming, setConfirming] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Button variant="secondary" size="small" onClick={onCancel} icon={<Icon name="arrow_back" size={15} />}>Annuler</Button>
        <h3 style={{ margin: 0, fontSize: 16 }}>Modifier l'objet</h3>
      </div>
      <ObjetCard draft={draft} previewUrl={draft.photo ? photoUrl(draft.photo) : ""} perquisition={perquisition} onChange={onChange} onRemove={onCancel} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <Button disabled={!complet || saveState.status === "saving"} onClick={onSave} icon={<Icon name="save" size={16} />}>
          Enregistrer les modifications
        </Button>
        {!complet && <span style={{ color: TODO, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="pending" size={15} /> Complétez l'objet (scellé, lieu, champs obligatoires).</span>}
        {saveState.status === "err" && <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {saveState.msg}</span>}
        {!confirming ? (
          <Button variant="secondary" color="error" onClick={() => setConfirming(true)} icon={<Icon name="delete" size={16} />} style={{ marginLeft: "auto" }}>
            Supprimer l'objet
          </Button>
        ) : (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: ERR, fontSize: 13 }}>Confirmer la suppression ?</span>
            <Button color="error" disabled={saveState.status === "saving"} onClick={onDelete} icon={<Icon name="delete" size={16} />}>
              Oui, supprimer
            </Button>
            <Button variant="secondary" size="small" onClick={() => setConfirming(false)}>Annuler</Button>
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- Écran 0 : perquisition ---------------- */
function SetupScreen({
  una,
  communePrefill,
  initial,
  onSubmit,
  onBack,
  inline = false,
}: {
  una: string;
  communePrefill?: { nom?: string; insee?: string; codePostal?: string };
  initial: Perquisition | null;
  onSubmit: (p: Perquisition) => void;
  onBack: () => void;
  inline?: boolean;         // rendu sous la liste (pas de page centrée plein écran)
}) {
  const [adresse, setAdresse] = useState(initial?.adresse ?? "");
  const [commune, setCommune] = useState(initial?.commune ?? communePrefill?.nom ?? "");
  const [codePostal, setCodePostal] = useState(initial?.codePostal ?? communePrefill?.codePostal ?? "");
  const [insee, setInsee] = useState(initial?.insee ?? communePrefill?.insee ?? "");
  const [dateDebut, setDateDebut] = useState(initial?.dateDebut ?? "");
  const [dateFin, setDateFin] = useState(initial?.dateFin ?? "");
  const [typeLieu, setTypeLieu] = useState<Perquisition["typeLieu"]>(initial?.typeLieu ?? "DOMICILE");
  const [perquisitionne, setPerquisitionne] = useState(initial?.perquisitionne ?? "");
  const [opj, setOpj] = useState(initial?.opj ?? "");
  const [intervenants, setIntervenants] = useState<string[]>(initial?.intervenants ?? ["", ""]);
  const [pieces, setPieces] = useState<string[]>(initial?.pieces ?? ["Garage", "Grenier"]);
  const [pieceInput, setPieceInput] = useState("");

  const [step, setStep] = useState(0);
  const v0 = adresse.trim() !== "" && commune.trim() !== "";
  const v1 = perquisitionne.trim() !== "" && opj.trim() !== "";
  const valid = v0 && v1;
  const stepValid = (s: number) => (s === 0 ? v0 : s === 1 ? v1 : true);
  const STEPS = ["Lieu", "Personnes", "Pièces"];

  const stepper = (
    <div style={{ display: "flex", gap: 8, margin: "0 0 22px" }}>
      {STEPS.map((t, i) => {
        const active = i === step;
        const reachable = i <= step || (i === step + 1 && stepValid(step));
        return (
          <button
            key={t}
            type="button"
            onClick={() => { if (reachable) setStep(i); }}
            aria-current={active ? "step" : undefined}
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
              borderRadius: 8, border: `1px solid ${active ? BRAND : BORDER}`,
              background: active ? BRAND_050 : "#fff", cursor: reachable ? "pointer" : "default",
              color: active ? BRAND : reachable ? "inherit" : MUTED, fontWeight: 600, fontSize: 13, textAlign: "left",
            }}
          >
            <span style={{ display: "inline-grid", placeItems: "center", width: 22, height: 22, borderRadius: 999, fontSize: 12, fontWeight: 700, background: active ? BRAND : i < step ? OK : "#e6e6ef", color: active || i < step ? "#fff" : MUTED }}>
              {i < step ? "✓" : i + 1}
            </span>
            {t}
          </button>
        );
      })}
    </div>
  );

  const stepLieu = (
    <Grid2>
      <Full>
        <Lbl req>Adresse</Lbl>
        <AddressAutocomplete
          value={adresse}
          onChange={(v) => setAdresse(v)}
          onSelect={(s) => {
            setAdresse(s.name);
            setCommune(s.commune);
            setCodePostal(s.codePostal);
            setInsee(s.insee);
          }}
        />
      </Full>
      <div>
        <Lbl req>Commune</Lbl>
        <input style={field} value={commune} onChange={(e) => setCommune(e.target.value)} placeholder="Roquevaire" />
      </div>
      <div>
        <Lbl>Code postal / INSEE</Lbl>
        <input style={field} value={codePostal} onChange={(e) => setCodePostal(e.target.value)} placeholder="13360" />
      </div>
      <div>
        <Lbl req>Date &amp; heure de début</Lbl>
        <input type="datetime-local" style={field} value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
      </div>
      <div>
        <Lbl>Date &amp; heure de fin</Lbl>
        <input type="datetime-local" style={field} value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
      </div>
      <div>
        <Lbl>Type de lieu</Lbl>
        <select style={field} value={typeLieu} onChange={(e) => setTypeLieu(e.target.value as Perquisition["typeLieu"])}>
          <option value="DOMICILE">Domicile</option>
          <option value="LOCAL_PRO">Local professionnel</option>
          <option value="VEHICULE">Véhicule</option>
          <option value="AUTRE">Autre</option>
        </select>
      </div>
    </Grid2>
  );

  const stepPersonnes = (
    <Grid2>
      <div>
        <Lbl req>Personne perquisitionnée</Lbl>
        <input style={field} value={perquisitionne} onChange={(e) => setPerquisitionne(e.target.value)} placeholder="Nom Prénom" />
      </div>
      <div>
        <Lbl req>O.P.J. rédacteur</Lbl>
        <input style={field} value={opj} onChange={(e) => setOpj(e.target.value)} placeholder="Grade, Nom" />
      </div>
      <Full>
        <Lbl>Assistants / accompagnants</Lbl>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {intervenants.map((v, i) => (
            <input
              key={i}
              style={field}
              value={v}
              placeholder="Grade, Nom"
              onChange={(e) => setIntervenants((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
        </div>
        <Button variant="secondary" size="small" onClick={() => setIntervenants((a) => [...a, ""])} style={{ marginTop: 8 }}>
          ＋ Ajouter une personne
        </Button>
      </Full>
    </Grid2>
  );

  const stepPieces = (
    <div>
      <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px" }}>
        Servira à suggérer l'emplacement de découverte de chaque objet (saisie libre possible).
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {pieces.map((p, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 12px", background: BRAND_050, border: `1px solid ${BRAND}`, borderRadius: 999, fontSize: 13, fontWeight: 600 }}>
            {p}
            <button aria-label="retirer" onClick={() => setPieces((a) => a.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", color: BRAND, fontSize: 16, cursor: "pointer" }}>
              ×
            </button>
          </span>
        ))}
        <input
          style={{ flex: 1, minWidth: 180, padding: "8px 12px", border: `1px dashed ${BORDER}`, borderRadius: 999, background: "transparent", fontFamily: "inherit", fontSize: 13 }}
          value={pieceInput}
          onChange={(e) => setPieceInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pieceInput.trim()) {
              e.preventDefault();
              setPieces((a) => [...a, pieceInput.trim()]);
              setPieceInput("");
            }
          }}
          placeholder="＋ ajouter (salon, chambre…)"
        />
      </div>
    </div>
  );

  const nav = (
    <div style={{ display: "flex", gap: 12, marginTop: 28, alignItems: "center" }}>
      {step > 0 && <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>← Précédent</Button>}
      <div style={{ marginLeft: "auto" }}>
        {step < 2 ? (
          <Button disabled={!stepValid(step)} onClick={() => setStep((s) => s + 1)}>Suivant →</Button>
        ) : (
          <Button
            disabled={!valid}
            onClick={() =>
              onSubmit({
                adresse, commune, codePostal, insee, dateDebut, dateFin, typeLieu, perquisitionne, opj,
                una,
                intervenants: intervenants.filter((x) => x.trim()),
                pieces,
              })
            }
          >
            {initial ? "Enregistrer et reprendre la saisie →" : "Démarrer la saisie des objets →"}
          </Button>
        )}
      </div>
    </div>
  );

  const inner = (
    <>
      <Button variant="secondary" size="small" onClick={onBack} style={{ marginBottom: 12 }}>{inline ? "Annuler" : "← Retour"}</Button>
      <div style={{ fontSize: 13, color: MUTED, margin: "0 0 4px" }}>Procédure : <strong>{una}</strong></div>
      <h2 style={{ margin: "0 0 18px", fontSize: 20 }}>Nouvelle perquisition</h2>
      {stepper}
      {step === 0 && stepLieu}
      {step === 1 && stepPersonnes}
      {step === 2 && stepPieces}
      {nav}
    </>
  );

  if (inline) return <div style={{ width: "100%", marginTop: 16 }}>{inner}</div>;
  return (
    <div style={{ display: "grid", placeItems: "start center", padding: "40px 20px 60px", overflowY: "auto", height: "100%" }}>
      <div style={{ ...card, width: "100%", maxWidth: 720, padding: "28px 32px 32px" }}>{inner}</div>
    </div>
  );
}

function FieldRow({ champ, onChange }: { champ: Champ; onChange: (v: string) => void }) {
  const filled = String(champ.valeur ?? "").trim() !== "";
  const isDeduit = champ.source === "deduit";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label style={label}>
        {champ.libelle}
        {champ.obligatoire && <span style={{ color: ERR }}>*</span>}
        <span style={{ marginLeft: "auto", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", padding: "2px 8px", borderRadius: 999, fontWeight: 700, background: isDeduit ? "#e3f5ea" : "#ffeede", color: isDeduit ? OK : TODO }}>
          {isDeduit ? "déduit" : "à saisir"}
        </span>
      </label>
      <input
        style={{ ...field, borderLeft: `3px solid ${filled ? OK : TODO}`, background: filled ? "#fff" : "#f6f6fb" }}
        value={String(champ.valeur ?? "")}
        placeholder={isDeduit ? "" : "à compléter"}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function BatchIdentify({ perquisition }: { perquisition: Perquisition }) {
  const { items, uploading, uploadError, saveState } = useSaisies();
  const importRef = useRef<HTMLInputElement>(null);

  const staging = items.filter((it) => it.status === "staging").length;
  const pending = items.filter((it) => it.status === "pending").length;
  const doneItems = items.filter((it) => it.status === "done" && it.draft);
  const errorCount = items.filter((it) => it.status === "error").length;
  const tousComplets = doneItems.length > 0 && doneItems.every((it) => objetComplet(it.draft!));
  const peutValider = staging === 0 && pending === 0 && doneItems.length > 0 && tousComplets && saveState.status !== "saving";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <input ref={importRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <Button onClick={() => importRef.current?.click()} icon={<Icon name="upload_file" size={18} />}>Importer des photos</Button>
        <Button variant="tertiary" size="small" onClick={addDemo}>Ajouter un objet de démo</Button>
      </div>

      {items.length === 0 && (
        <div style={{ ...card, padding: 32, textAlign: "center", color: MUTED }}>
          <Icon name="add_a_photo" size={28} color={BRAND} />
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>Ajoutez des photos, renseignez le n° de scellé et la pièce ; l'analyse démarre automatiquement.</p>
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map((it) => {
            if (it.status === "staging") {
              return (
                <section
                  key={it.id}
                  style={{ ...card, padding: 14, display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}
                  onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) analyze(it.id); }}
                >
                  {it.previewUrl && <img src={it.previewUrl} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6 }} />}
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <Lbl req>N° de scellé</Lbl>
                    <input
                      style={field}
                      value={it.numeroScelle}
                      placeholder="ex. SC-2026-014"
                      onChange={(e) => patchItem(it.id, { numeroScelle: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <Lbl>Pièce de découverte</Lbl>
                    <select style={field} value={it.lieu} onChange={(e) => patchItem(it.id, { lieu: e.target.value })}>
                      <option value="">— choisir la pièce —</option>
                      {perquisition.pieces.map((p) => <option key={p} value={p}>{p}</option>)}
                      {it.lieu && !perquisition.pieces.includes(it.lieu) && <option value={it.lieu}>{it.lieu}</option>}
                    </select>
                  </div>
                  <span style={{ color: MUTED, fontSize: 12, paddingBottom: 10 }}>Renseignez le scellé et la pièce ; l'analyse démarre en quittant la ligne.</span>
                  <Button size="small" variant="tertiary" color="neutral" onClick={() => removeItem(it.id)} aria-label="Retirer" icon={<Icon name="delete" size={16} />} style={{ marginBottom: 2 }} />
                </section>
              );
            }
            if (it.status === "pending") {
              return (
                <section key={it.id} role="status" style={{ ...card, padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
                  {it.previewUrl && <img src={it.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}
                  <Icon name="hourglass_top" size={18} color={BRAND} /> <span style={{ color: MUTED }}>Analyse en cours…</span>
                </section>
              );
            }
            if (it.status === "error") {
              return (
                <section key={it.id} style={{ ...card, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                  {it.previewUrl && <img src={it.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}
                  <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {it.error}</span>
                  <Button variant="secondary" size="small" onClick={() => removeItem(it.id)} style={{ marginLeft: "auto" }}>Retirer</Button>
                </section>
              );
            }
            if (it.status === "done" && it.draft) {
              return (
                <ObjetCard key={it.id} draft={it.draft} previewUrl={it.previewUrl} perquisition={perquisition} onChange={(o) => patchItem(it.id, { draft: o })} onRemove={() => removeItem(it.id)} />
              );
            }
            return null;
          })}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <Button disabled={!peutValider || uploading} onClick={validerTout} icon={<Icon name="save" size={16} />}>
            Valider tout ({doneItems.length})
          </Button>
          {!tousComplets && doneItems.length > 0 && pending === 0 && (
            <span style={{ color: TODO, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="pending" size={15} /> Complétez tous les objets (scellé, lieu, champs obligatoires).</span>
          )}
          {errorCount > 0 && <span style={{ color: MUTED, fontSize: 12.5 }}>{errorCount} photo(s) en erreur ignorée(s).</span>}
          {uploadError && <span style={{ color: ERR, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {uploadError}</span>}
          {saveState.status === "ok" && <span style={{ color: OK, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="check_circle" size={16} /> Enregistré</span>}
          {saveState.status === "err" && <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {saveState.msg}</span>}
        </div>
      )}
    </div>
  );
}

export function ObjetCard({
  draft,
  previewUrl,
  perquisition,
  onChange,
  onRemove,
}: {
  draft: ObjetSaisi;
  previewUrl: string;
  perquisition: Perquisition;
  onChange: (o: ObjetSaisi) => void;
  onRemove: () => void;
}) {
  const complet = objetComplet(draft);

  function setChamp(cle: string, valeur: string) {
    onChange({ ...draft, champs: draft.champs.map((c) => (c.cle === cle ? { ...c, valeur } : c)) });
  }
  function changeCategorie(categorie: CategorieCode) {
    const sousType = categorie === "TRANSPORT" ? draft.sousType : undefined;
    onChange({ ...draft, categorie, sousType, champs: recomputeChamps(draft.champs, categorie, sousType) });
  }
  function changeSousType(sousType: SousTypeTransport) {
    onChange({ ...draft, sousType, champs: recomputeChamps(draft.champs, "TRANSPORT", sousType) });
  }

  return (
    <section style={{ ...card, display: "grid", gridTemplateColumns: "1fr 240px", gap: 0, overflow: "hidden" }}>
      <div style={{ padding: 18, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Icon name={CATEGORIES[draft.categorie].icon} size={20} color={BRAND} />
          <span style={{ fontSize: 12.5, color: MUTED }}>{Math.round(draft.confiance * 100)} % de confiance</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: complet ? OK : TODO }}>
            <Icon name={complet ? "check_circle" : "pending"} size={16} /> {complet ? "Complet" : "À compléter"}
          </span>
          <Button size="small" variant="tertiary" color="neutral" aria-label="Retirer" onClick={onRemove} icon={<Icon name="delete" size={18} />} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: 14 }}>
          <div>
            <Lbl req>Catégorie</Lbl>
            <select style={field} value={draft.categorie} onChange={(e) => changeCategorie(e.target.value as CategorieCode)}>
              {(Object.keys(CATEGORIES) as CategorieCode[]).map((c) => (
                <option key={c} value={c}>{CATEGORIES[c].libelle}</option>
              ))}
            </select>
          </div>
          {draft.categorie === "TRANSPORT" && (
            <div>
              <Lbl>Sous-type</Lbl>
              <select style={field} value={draft.sousType ?? ""} onChange={(e) => changeSousType(e.target.value as SousTypeTransport)}>
                <option value="">— choisir —</option>
                {(Object.keys(SOUS_TYPES_TRANSPORT) as SousTypeTransport[]).map((s) => (
                  <option key={s} value={s}>{SOUS_TYPES_TRANSPORT[s]}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", padding: "12px 14px", marginBottom: 16, background: BRAND_050, border: `1px solid ${BRAND}`, borderRadius: 8 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Lbl req>N° de scellé</Lbl>
            <input style={field} value={draft.numeroScelle} placeholder="ex. SC-2026-014" onChange={(e) => onChange({ ...draft, numeroScelle: e.target.value })} />
          </div>
          <div style={{ maxWidth: 180 }}>
            <Lbl>Situation</Lbl>
            <select style={field} value={draft.situation} onChange={(e) => onChange({ ...draft, situation: e.target.value as SituationScelle })}>
              <option value="SAISI_SOUS_SCELLE">Saisi — sous scellé</option>
              <option value="SAISI_NON_SCELLE">Saisi — non scellé</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Lbl req>Lieu de découverte</Lbl>
            <select style={field} value={draft.lieu} onChange={(e) => onChange({ ...draft, lieu: e.target.value })}>
              <option value="">— choisir la pièce —</option>
              {perquisition.pieces.map((p) => <option key={p} value={p}>{p}</option>)}
              {draft.lieu && !perquisition.pieces.includes(draft.lieu) && <option value={draft.lieu}>{draft.lieu}</option>}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
          {draft.champs.map((c) => <FieldRow key={c.cle} champ={c} onChange={(v) => setChamp(c.cle, v)} />)}
        </div>
      </div>

      <div style={{ background: "#f6f6fb", borderLeft: `1px solid ${BORDER}`, display: "grid", placeItems: "center", padding: 12 }}>
        {previewUrl
          ? <img src={previewUrl} alt="Objet" style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 6, objectFit: "contain" }} />
          : <span style={{ color: MUTED, fontSize: 12.5, textAlign: "center" }}><Icon name="image" size={28} /><br />Sans photo</span>}
      </div>
    </section>
  );
}

/* ---------------- autocomplétion adresse (BAN) ---------------- */
function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: AdresseSuggestion) => void;
}) {
  const [sugg, setSugg] = useState<AdresseSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const justSelected = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false;
      setSugg([]);
      setOpen(false);
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSugg([]);
      setOpen(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      searchAdresse(q, fetch, ctrl.signal)
        .then((r) => {
          setSugg(r);
          setOpen(r.length > 0);
        })
        .catch(() => {
          /* abort ou erreur réseau : on ignore silencieusement */
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        style={field}
        value={value}
        placeholder="Commencer à saisir l'adresse…"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => sugg.length > 0 && setOpen(true)}
      />
      {loading && <span style={{ position: "absolute", right: 12, top: 11, fontSize: 13, color: MUTED }}>…</span>}
      {open && (
        <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 4, position: "absolute", zIndex: 20, left: 0, right: 0, ...card, maxHeight: 260, overflowY: "auto" }}>
          {sugg.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  justSelected.current = true;
                  onSelect(s);
                  setOpen(false);
                }}
                style={{ width: "100%", textAlign: "left", padding: "9px 12px", border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", fontSize: 13.5 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = BRAND_050)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <b>{s.name}</b>
                <span style={{ color: MUTED }}> — {s.codePostal} {s.commune}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p style={{ fontSize: 11, color: MUTED, margin: "4px 0 0" }}>Autocomplétion : Base Adresse Nationale (data.gouv.fr).</p>
    </div>
  );
}

/* ---------------- petits helpers de mise en page ---------------- */
function Icon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-icons" aria-hidden style={{ fontSize: size, lineHeight: 1, verticalAlign: "middle", color }}>
      {name}
    </span>
  );
}
function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 20px" }}>{children}</div>;
}
function Full({ children }: { children: React.ReactNode }) {
  return <div style={{ gridColumn: "1 / -1" }}>{children}</div>;
}
function Lbl({ children, req }: { children: React.ReactNode; req?: boolean }) {
  return <label style={label}>{children}{req && <span style={{ color: ERR }}>*</span>}</label>;
}
