// src/features/rgp/RgpResult.tsx
import { useEffect, useState } from "react";
import Markdown from "../../lib/chat/Markdown";
import type { RgpReply } from "./rgpApi";

// Effet d'écriture (comme l'onglet Questions d'Ariane, qui lui reçoit un vrai flux SSE) :
// la réponse RGP arrive d'un bloc, on la RÉVÈLE progressivement côté client. Chaque message
// n'est animé qu'UNE fois — un id déjà « écrit » (re-render, retour sur la page) s'affiche
// entier d'emblée, sans rejouer l'animation.
const dejaEcrits = new Set<number>();
const CAR_PAR_TICK = 3;
const TICK_MS = 16;

function Typewriter({ id, texte }: { id: number; texte: string }) {
  const [n, setN] = useState(() => (dejaEcrits.has(id) ? texte.length : 0));
  useEffect(() => {
    if (dejaEcrits.has(id)) { setN(texte.length); return; }
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i = Math.min(i + CAR_PAR_TICK, texte.length);
      setN(i);
      if (i < texte.length) timer = setTimeout(step, TICK_MS);
      else dejaEcrits.add(id);
    };
    timer = setTimeout(step, TICK_MS);
    return () => clearTimeout(timer);
  }, [id, texte]);
  return <Markdown>{texte.slice(0, n)}</Markdown>;
}

export default function RgpResult({ reply, animateId }: { reply: RgpReply; animateId?: number }) {
  const { parsed, message, text } = reply;

  // Erreur métier RGP.
  if (parsed && "error" in parsed && parsed.error) {
    return (
      <p role="alert" style={{ color: "#e1000f", margin: 0 }}>
        {parsed.error.message} ({parsed.error.code})
      </p>
    );
  }

  // L'agent a DÉCRIT l'appel d'outil ({call, args}) au lieu de l'exécuter (variance LLM ;
  // le proxy réessaie, mais si ça persiste on l'explique clairement).
  if (parsed && typeof parsed === "object" && !("data" in parsed) && !("error" in parsed) && ("call" in parsed || "args" in parsed)) {
    return (
      <p role="alert" style={{ color: "#b34000", margin: 0 }}>
        L'assistant n'a pas exécuté l'action (il a seulement décrit l'appel). Reformulez ou réessayez.
      </p>
    );
  }

  // Réponse de l'agent, rendue en markdown (l'agent formate tableaux/gras/listes lui-même).
  // Repli : si l'agent n'a pas rédigé (ancien prompt renvoyant du JSON), on affiche les
  // données brutes en bloc code, sinon le texte tel quel.
  const data = parsed && "data" in parsed ? parsed.data : undefined;
  const md =
    (message && message.trim()) ||
    (data ? "```json\n" + JSON.stringify(data, null, 2) + "\n```" : text || "");

  return (
    <div style={{ lineHeight: 1.5 }}>
      {animateId != null ? <Typewriter id={animateId} texte={md} /> : <Markdown>{md}</Markdown>}
    </div>
  );
}
