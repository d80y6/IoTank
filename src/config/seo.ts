// src/config/seo.ts

export interface SeoJurisdiction {
  name?: string;
  countryCode?: string;
  regulatoryBody?: string | null;
}

export function buildStructuredData(jurisdiction?: SeoJurisdiction) {
  const region = jurisdiction?.name || 'Global';
  const countryCode = jurisdiction?.countryCode?.toUpperCase() || 'WW';
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "name": "IoTank",
        "alternateName": "IoTank Fuel Intelligence",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Web",
        "description": `IoTank is an AI-powered industrial IoT platform for real-time fuel tank monitoring, leak detection, and procurement intelligence in ${region}.`,
        "url": "https://the-iotank-project.web.app/",
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD"
        }
      },
      {
        "@type": "Organization",
        "name": `IoTank ${region}`,
        "legalName": "Joe Engineering Ltd",
        "url": "https://the-iotank-project.web.app/",
        "logo": "https://the-iotank-project.web.app/logo.webp",
        "contactPoint": {
          "@type": "ContactPoint",
          "telephone": "+1-000-000-0000",
          "contactType": "customer service",
          "areaServed": countryCode,
          "availableLanguage": "en"
        },
        "sameAs": [
          "https://twitter.com/iotank",
          "https://linkedin.com/company/iotank"
        ]
      }
    ]
  };
}

export function buildSeoDefaults(jurisdiction?: SeoJurisdiction) {
  const region = jurisdiction?.name || 'Global';
  const regBody = jurisdiction?.regulatoryBody || 'national';
  return {
    title: `IoTank | AI Fuel Monitoring System & Petrol Station Analytics ${region}`,
    description: `IoTank is a premier AI-powered fuel monitoring system. Engineered for precision underground tank monitoring, IoTank provides real-time leak detection, ${regBody}-compliant reporting, and intelligent fuel procurement analytics to prevent losses across ${region}.`,
    keywords: `IoTank, fuel monitoring system ${region}, IoTank fuel monitoring, fuel tank monitoring ${region}, ${regBody} compliance software, fuel theft detection, AI fuel procurement, petrol station inventory management, underground tank monitoring, industrial IoT`,
    author: "Joe Engineering Ltd",
    themeColor: "#00D4FF"
  };
}

export const structuredData = buildStructuredData();

export const seoDefaults = buildSeoDefaults();

export function applySeoMeta(seo: ReturnType<typeof buildSeoDefaults>) {
  document.title = seo.title;

  const setMeta = (name: string, content: string) => {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', name);
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', content);
  };

  setMeta('description', seo.description);
  setMeta('keywords', seo.keywords);
}