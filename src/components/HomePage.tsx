import {
  Homepage,
  LaSuiteTranslationsProvider,
  frTranslations,
} from "@gouvfr-lasuite/integration";
import { LaGaufreV2 } from "@gouvfr-lasuite/ui-kit";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import IakaLogo from "./IakaLogo";

export default function HomePage({ onEnter }: { onEnter: () => void }) {
  return (
    <LaSuiteTranslationsProvider translations={frTranslations}>
      <Homepage
        entity={
          <>
            Ministère
            <br />
            de l'Intérieur
          </>
        }
        serviceName="Expérimentation IAKA DGGN"
        logo={<IakaLogo />}
        tagline="**1ère phase**, bilan intermédiaire"
        homepageUrl="/"
        headerOptions={{
          actions: (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                width: "100%",
              }}
            >
              <LaGaufreV2
                apiUrl="https://lasuite.numerique.gouv.fr/api/services"
                widgetPath="https://static.suite.anct.gouv.fr/widgets/lagaufre.js"
              />
            </div>
          ),
        }}
        footerOptions={{
          a11yLevel: "non compliant",
          links: [],
        }}
      >
        <div
          className="fr-flex fr-direction-column"
          style={{ gap: "1.25rem" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            <img
              src="/logo-sp2c.png"
              alt=""
              style={{ height: "4.5rem", flexShrink: 0 }}
            />
            <h2
              className="fr-mb-0"
              style={{ fontSize: "1rem", fontWeight: 700, lineHeight: 1.4 }}
            >
              Plate-forme de présentation des cas d'usages
            </h2>
          </div>

          <Button type="button" fullWidth onClick={onEnter} style={{ marginTop: "0.75rem" }}>
            Entrer
          </Button>
        </div>
      </Homepage>
    </LaSuiteTranslationsProvider>
  );
}
