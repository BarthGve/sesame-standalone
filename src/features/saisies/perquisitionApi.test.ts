import { describe, it, expect } from "vitest";
import { buildPerquisitionPayload, savePerquisition, listProcedures, listPerquisitions, getPerquisition, addObjets, updateObjet, deleteObjet, apiObjetToDraft, photoUrl, uploadPhoto } from "./perquisitionApi";
import type { ApiObjet } from "./perquisitionApi";
import type { Perquisition, ObjetSaisi } from "./types";

const perq = {
  adresse: "1 rue X", commune: "Segré", codePostal: "49500", insee: "49331",
  dateDebut: "", typeLieu: "DOMICILE", perquisitionne: "M. X", opj: "OPJ Y",
  intervenants: ["Adj Dupont", ""], pieces: ["Garage", ""],
} as Perquisition;

const objet = {
  id: "o1", categorie: "TRANSPORT", sousType: "VEHICULE_TERRESTRE", confiance: 0.9,
  numeroScelle: "SC1", situation: "SAISI_SOUS_SCELLE", lieu: "Garage",
  champs: [{ cle: "nmr_immatriculation", libelle: "N° imm", valeur: "AB-123-CD", source: "deduit", obligatoire: false }],
} as ObjetSaisi;

describe("buildPerquisitionPayload", () => {
  it("mappe le modèle front vers le payload API", () => {
    const p = buildPerquisitionPayload(perq, "12/34/2024", [objet]);
    expect(p.una).toBe("12/34/2024");
    expect(p.commune).toBe("49331");           // insee prioritaire sur commune
    expect(p.intervenants).toEqual(["Adj Dupont"]); // vides filtrés
    expect(p.pieces).toEqual(["Garage"]);
    expect(p.objets[0].sous_type).toBe("VEHICULE_TERRESTRE");
    expect(p.objets[0].champs[0].valeur).toBe("AB-123-CD");
  });
});

describe("savePerquisition", () => {
  it("retourne l'id sur succès", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 7 } }) });
    expect(await savePerquisition({} as any, fake as any)).toEqual({ id: 7 });
  });
  it("lève sur enveloppe d'erreur (HTTP 200 + {error})", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { code: "una_inconnu", message: "UNA introuvable" } }) });
    await expect(savePerquisition({} as any, fake as any)).rejects.toThrow("UNA introuvable");
  });
});

describe("listProcedures", () => {
  it("retourne la liste sur succès", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ una: "1/2/2024", type: "PVEJ" }] }) });
    const out = await listProcedures({}, fake as any);
    expect(out[0].una).toBe("1/2/2024");
  });
  it("passe les filtres en query", async () => {
    let url = "";
    const fake = async (u: string) => { url = u; return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
    await listProcedures({ annee: "2024", unite: "15127" }, fake as any);
    expect(url).toContain("annee=2024");
    expect(url).toContain("unite=15127");
  });
});

describe("listPerquisitions", () => {
  it("retourne les perquisitions d'un UNA", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 3, adresse: "1 rue", nb_objets: 2 }] }) });
    const out = await listPerquisitions("1/2/2024", fake as any);
    expect(out[0].id).toBe(3);
  });
});

describe("getPerquisition", () => {
  it("retourne le détail", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 3, una: "1/2/2024", objets: [] } }) });
    const out = await getPerquisition(3, fake as any);
    expect(out.id).toBe(3);
  });
});

describe("addObjets", () => {
  it("poste les objets mappés et retourne l'id", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { id: 9 } }) }; };
    const objet = { id: "o1", categorie: "DIVERS", numeroScelle: "SC1", champs: [] } as any;
    const out = await addObjets(9, [objet], fake as any);
    expect(out).toEqual({ id: 9 });
    expect(body.perquisition_id).toBe(9);
    expect(body.objets[0].categorie).toBe("DIVERS");
    expect(body.objets[0].numero_scelle).toBe("SC1");
  });
  it("lève sur enveloppe d'erreur", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "Perquisition 9 introuvable" } }) });
    await expect(addObjets(9, [], fake as any)).rejects.toThrow("introuvable");
  });
});

describe("updateObjet", () => {
  it("poste objet_id + champs mappés et retourne le détail", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { id: 3, objets: [] } }) }; };
    const objet = { id: "o1", categorie: "TRANSPORT", numeroScelle: "SC1", champs: [] } as any;
    const out = await updateObjet(7, objet, fake as any);
    expect(out.id).toBe(3);
    expect(body.objet_id).toBe(7);
    expect(body.categorie).toBe("TRANSPORT");
    expect(body.numero_scelle).toBe("SC1");
  });
  it("lève sur enveloppe d'erreur", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "Objet 7 introuvable" } }) });
    await expect(updateObjet(7, { champs: [] } as any, fake as any)).rejects.toThrow("introuvable");
  });
});

describe("deleteObjet", () => {
  it("poste objet_id et retourne le détail", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { id: 3, objets: [] } }) }; };
    const out = await deleteObjet(42, fake as any);
    expect(out.id).toBe(3);
    expect(body.objet_id).toBe(42);
  });
  it("lève sur enveloppe d'erreur", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "Objet 42 introuvable" } }) });
    await expect(deleteObjet(42, fake as any)).rejects.toThrow("introuvable");
  });
});

describe("apiObjetToDraft", () => {
  it("map un ApiObjet vers un ObjetSaisi éditable", () => {
    const api: ApiObjet = {
      id: 42, categorie: "MULTIMEDIA", sous_type: null, numero_scelle: "SC-9", situation: "SAISI_NON_SCELLE", lieu: "Salon",
      champs: [{ cle: "imei", libelle: "IMEI", valeur: "123", source: null, obligatoire: false }],
      identifiants: [{ type: "IMEI", valeur: "123" }],
    };
    const d = apiObjetToDraft(api);
    expect(d.id).toBe("42");
    expect(d.categorie).toBe("MULTIMEDIA");
    expect(d.sousType).toBeUndefined();
    expect(d.numeroScelle).toBe("SC-9");
    expect(d.situation).toBe("SAISI_NON_SCELLE");
    expect(d.champs[0].source).toBe("a_completer"); // source null -> a_completer
  });
});

describe("photoUrl", () => {
  it("construit l'URL de service encodée", () => {
    expect(photoUrl("a b/c.jpg")).toBe("/api/photo?key=a%20b%2Fc.jpg");
  });
});

describe("uploadPhoto", () => {
  it("poste l'image et retourne la clé", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { key: "k1.jpg" } }) }; };
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const key = await uploadPhoto(file, fake as any);
    expect(key).toBe("k1.jpg");
    expect(typeof body.imageBase64).toBe("string");
    expect(body.mime).toBe("image/jpeg");
    expect(body.filename).toBe("photo.jpg");
  });
});

describe("apiObjetToDraft photo", () => {
  it("reporte photo_url en photo", () => {
    const api: any = { id: 1, categorie: "DIVERS", champs: [], identifiants: [], photo_url: "k.jpg" };
    expect(apiObjetToDraft(api).photo).toBe("k.jpg");
  });
});
