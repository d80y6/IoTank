// src/config/seo.ts

export const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "name": "IoTank",
      "alternateName": "IoTank Fuel Intelligence",
      "applicationCategory": "BusinessApplication",
      "operatingSystem": "Web",
      "description": "IoTank is an AI-powered industrial IoT platform for real-time fuel tank monitoring, leak detection, and procurement intelligence in Kenya.",
      "url": "https://the-iotank-project.web.app/",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "KES"
      }
    },
    {
      "@type": "Organization",
      "name": "IoTank Kenya",
      "legalName": "Joe Engineering Ltd",
      "url": "https://the-iotank-project.web.app/",
      "logo": "https://the-iotank-project.web.app/logo.webp",
      "contactPoint": {
        "@type": "ContactPoint",
        "telephone": "+254-111-746-901",
        "contactType": "customer service",
        "areaServed": "KE",
        "availableLanguage": "en"
      },
      "sameAs": [
        "https://twitter.com/iotank",
        "https://linkedin.com/company/iotank"
      ]
    }
  ]
};

export const seoDefaults = {
  title: "IoTank | AI Fuel Monitoring System & Petrol Station Analytics Kenya",
  description: "IoTank is Kenya's premier AI-powered fuel monitoring system. Engineered for precision underground tank monitoring, IoTank provides real-time leak detection, EPRA-compliant reporting, and intelligent fuel procurement analytics to prevent losses.",
  keywords: "IoTank, fuel monitoring system Kenya, IoTank fuel monitoring, fuel tank monitoring Kenya, EPRA compliance software, fuel theft detection Kenya, AI fuel procurement, petrol station inventory management, underground tank monitoring, industrial IoT Kenya",
  author: "Joe Engineering Ltd",
  themeColor: "#00D4FF"
};
