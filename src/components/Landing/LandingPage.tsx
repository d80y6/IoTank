import React, { useEffect, useState, Suspense, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  FiCheckCircle, FiMessageSquare, FiDroplet,
  FiTwitter, FiLinkedin, FiFacebook, FiMenu, FiX,
  FiTarget, FiThermometer, FiZap, FiCloud, FiActivity, FiLayout, FiShield,
  FiMail
} from 'react-icons/fi';

import './LandingPage.css';
import '../../styles/ScrollAnimations.css';
import {
  useScrollAnimation,
  useGlobalScrollProgress,
  useCounterAnimation,
} from '../../hooks/useScrollAnimation';

// Import Assets
import brandMark from '@/assets/iotank-official-logo.png';
import dashboardMockup from '@/assets/dashboard-mockup.png';

const ExcellenceSection = React.lazy(() => import('./ExcellenceSection'));
const OwnershipSection = React.lazy(() => import('./OwnershipSection'));
const SecuritySection = React.lazy(() => import('./SecuritySection'));
const FAQSection = React.lazy(() => import('./FAQSection'));
const PartnersClientsSection = React.lazy(() => import('./PartnersClientsSection'));
const ComplianceOverview = React.lazy(() => import('./ComplianceOverview').then(module => ({ default: module.ComplianceOverview })));
const InteractiveDashboardSnippet = React.lazy(() => import('./InteractiveDashboardSnippet'));
const TestimonialCarousel = React.lazy(() => import('./TestimonialCarousel'));
const LeadMagnetNewsletter = React.lazy(() => import('./LeadMagnetNewsletter'));

import { DocViewer } from './DocViewer';
import { LiveChat } from './LiveChat';
import { logger } from '@/utils/logger';
import {
    LossCalculatorModal,
    CrisisIntro,
    ProfitKillers,
    SocialProofBar
} from './FuelChallengesSection';

/* ─── Counter Stat Helper ────────────────────────────────────── */
const CounterStat: React.FC<{ target: number; suffix?: string; prefix?: string; duration?: number }> = ({
  target, suffix = '', prefix = '', duration = 1800
}) => {
  const { elementRef, count } = useCounterAnimation(target, duration);
  return (
    <span ref={elementRef} className="counter-stat">
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
};

/* ─── Split Text Helper ──────────────────────────────────────── */
const SplitText: React.FC<{ text: string; className?: string; isVisible: boolean }> = ({
  text, className = '', isVisible
}) => {
  const words = text.split(' ');
  return (
    <span className={`kinetic-text ${isVisible ? 'is-visible' : ''} ${className}`}>
      {words.map((word, i) => (
        <span key={i} className="split-word" style={{ marginRight: '0.28em' }}>
          {word}
        </span>
      ))}
    </span>
  );
};


export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [isDocViewerOpen, setIsDocViewerOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLossCalcOpen, setIsLossCalcOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  // ── Global scroll progress (for progress bar) ────────────────
  const scrollProgress = useGlobalScrollProgress();

  // ── Section scroll animations ─────────────────────────────────
  const { elementRef: problemRef, isVisible: problemVisible } = useScrollAnimation(0.05); /* Lowered from 0.1 */
  const { elementRef: solutionHeadRef, isVisible: solutionHeadVisible } = useScrollAnimation(0.08); /* Lowered from 0.15 */
  const { elementRef: solutionCardsRef, isVisible: solutionCardsVisible } = useScrollAnimation(0.05);
  const { elementRef: howWorksRef, isVisible: howWorksVisible } = useScrollAnimation(0.05);
  const { elementRef: excellenceRef, isVisible: excellenceVisible } = useScrollAnimation(0.05);
  const { elementRef: solutionRef, isVisible: solutionVisible } = useScrollAnimation(0.05);
  const { elementRef: testimonialRef, isVisible: testimonialVisible } = useScrollAnimation(0.05);
  const { elementRef: dashboardSimRef, isVisible: dashboardSimVisible } = useScrollAnimation(0.05);
  const { elementRef: newsletterRef, isVisible: newsletterVisible } = useScrollAnimation(0.05);
  const { elementRef: finalCTARef, isVisible: finalCTAVisible } = useScrollAnimation(0.05);
  const { elementRef: pricingRef, isVisible: pricingVisible } = useScrollAnimation(0.05);
  const { elementRef: aiSectionRef, isVisible: aiSectionVisible } = useScrollAnimation(0.08);
  const { elementRef: complianceRef, isVisible: complianceVisible } = useScrollAnimation(0.05);

  const videos: string[] = ['/IoTank animation demo.mp4'];
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  // ── Video IntersectionObserver ────────────────────────────────
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          videoElement.play().catch(err => logger.warn("Video play interrupted:", err));
        } else {
          videoElement.pause();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(videoElement);
    return () => observer.disconnect();
  }, []);

  // ── Custom scroll handle ──────────────────────────────────────
  useEffect(() => {
    const updateHandlePosition = () => {
      if (!handleRef.current) return;
      const scrollY = window.scrollY;
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight > 0) {
        const progress = scrollY / scrollHeight;
        const top = progress * (window.innerHeight - 18);
        handleRef.current.style.top = `${top}px`;
      }
      setScrolled(scrollY > 50);
      scrollRafRef.current = null;
    };

    const onScroll = () => {
      if (!scrollRafRef.current) {
        scrollRafRef.current = requestAnimationFrame(updateHandlePosition);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        const trackHeight = window.innerHeight - 20;
        window.scrollBy(0, (e.movementY / trackHeight) * scrollHeight);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    updateHandlePosition();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.style.userSelect = 'none';
  };

  // ── Parallax for hero ─────────────────────────────────────────
  const [parallaxY, setParallaxY] = useState(0);
  useEffect(() => {
    const handleScroll = () => setParallaxY(window.scrollY * 0.4);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // [AUTH BUGFIX]: Redirect authenticated users away from the landing page
  const { currentUser, loading: authLoading } = useAuth();
  useEffect(() => {
    if (!authLoading && currentUser?.stationId) {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, authLoading, navigate]);

  // ── Magnetic Button ───────────────────────────────────────────
  const magneticBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const btn = magneticBtnRef.current;
    if (!btn) return;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      const distance = Math.sqrt(x * x + y * y);
      btn.style.transform = distance < 100 ? `translate(${x * 0.3}px, ${y * 0.3}px) scale(1.05)` : '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleGetStarted = () => navigate('/login');

  return (
    <div className="landing-page">
      {/* ── Global Scroll Progress Bar ──────────────────────────── */}
      <div
        className="scroll-progress-bar"
        style={{ width: `${scrollProgress * 100}%` }}
        aria-hidden="true"
      />

      {/* Documentation Viewer */}
      <DocViewer isOpen={isDocViewerOpen} onClose={() => setIsDocViewerOpen(false)} />

      {/* Global Loss Calculator Modal */}
      {isLossCalcOpen && (
        <LossCalculatorModal onClose={() => setIsLossCalcOpen(false)} />
      )}

      {/* ══════════════════════════════════════════════════════════
          1. NAVBAR
      ══════════════════════════════════════════════════════════ */}
      <nav className={`navbar ${scrolled ? 'scrolled' : ''} ${isMenuOpen ? 'menu-open' : ''}`}>
        <div className="container navbar-inner">
          <div className="brand">
            <img src={brandMark} alt="IoTank AI Fuel Monitoring Kenya" className="brand-logo-nav" style={{ width: 'auto', height: '38px' }} />
            <span>Joe Engineering</span>
          </div>

          <button
            className="mobile-menu-toggle"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle navigation menu"
          >
            {isMenuOpen ? <FiX /> : <FiMenu />}
          </button>

          <div className={`nav-actions-container ${isMenuOpen ? 'mobile-visible' : ''}`}>
            <div className="nav-links">
              <a href="#problem" onClick={() => setIsMenuOpen(false)}>Challenges</a>
              <a href="#solution-overview" onClick={() => setIsMenuOpen(false)}>Solution</a>
              <a href="#how-it-works" onClick={() => setIsMenuOpen(false)}>How It Works</a>
              <a href="#pricing" onClick={() => setIsMenuOpen(false)}>Pricing</a>
              <a href="#faq" onClick={() => setIsMenuOpen(false)}>FAQ</a>
            </div>
            <div className="nav-btn-container">
              <button className="btn-primary btn-gemini-glow" onClick={() => { handleGetStarted(); setIsMenuOpen(false); }}>
                Get Started
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ══════════════════════════════════════════════════════════
          2. HERO — Kinetic Typography + Parallax
      ══════════════════════════════════════════════════════════ */}
      <header className="hero">
        <div className="container">
          {/* Kinetic H1 — words slide up on load */}
          <div className="hero-content text-center">
            <h1 className="hero-h1 hero-kinetic-h1">
              <span className="sr-only">IoTank: AI-powered fuel monitoring system for safer, smarter petrol stations in Kenya.</span>
              <span className="word-line" aria-hidden="true"><span>Fuel intelligence for</span></span>
              <span className="word-line" aria-hidden="true"><span>safer, smarter stations.</span></span>
            </h1>
          </div>

          <div className="hero-visual-inner" style={{ transform: `translateY(${parallaxY}px)` }}>
            <div className={`hero-video-container ${videoFailed ? 'video-failed' : ''}`}>
              <video
                ref={videoRef}
                className="hero-video-bg"
                src={videoFailed ? undefined : videos[0]}
                autoPlay={!videoFailed}
                loop
                muted
                playsInline
                preload="metadata"
                crossOrigin="anonymous"
                onError={(e) => { logger.error("Local video failed:", e); setVideoFailed(true); }}
                poster={brandMark}
                title="Modern Data Flow Animation"
                onCanPlay={(e) => (e.currentTarget.muted = true)}
              />
              <div className="hero-video-overlay">
                {/* Subtitle reveal */}
                <h3 className="h3 text-white mb-4 hero-subtitle-reveal" style={{ textShadow: '0 2px 15px rgba(0,0,0,0.8)' }}>
                  Stop invisible fuel losses before they cost you millions.
                </h3>
                <p className="hero-overlay-p hero-subtitle-reveal" style={{ animationDelay: '0.95s' }}>
                  Real-time underground tank monitoring, AI-driven procurement insights, and compliance-ready reporting — engineered for high-risk fuel environments in Kenya.
                </p>
                <div className="hero-overlay-btns hero-cta-reveal">
                  <button
                    ref={magneticBtnRef}
                    className="btn-primary btn-gemini-glow"
                    onClick={handleGetStarted}
                  >
                    Get Started
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(5px)' }}
                    onClick={() => {
                      const video = videoRef.current;
                      if (video) { video.currentTime = 0; video.play(); }
                    }}
                  >
                    View Demo
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Scroll Indicator */}
          <div className="hero-scroll-indicator">
            <div className="mouse"><div className="wheel"></div></div>
            <div>
              <span className="m_scroll_arrows first"></span>
              <span className="m_scroll_arrows second"></span>
              <span className="m_scroll_arrows third"></span>
            </div>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════
          3. SECTION 1 — THE ECONOMIC REALITY
          Strategy: Reveal up + stagger children
      ══════════════════════════════════════════════════════════ */}
      <div ref={problemRef} className={`reveal-on-scroll ${problemVisible ? 'is-visible' : ''}`}>
        <section id="problem" className="section-bg-mist" style={{ paddingTop: '40px', paddingBottom: '16px' }}>
          <div className="container">
            <CrisisIntro onShowCalculator={() => setIsLossCalcOpen(true)} />
            <div style={{ marginTop: '16px' }}>
              <Suspense fallback={<div className="section-loader">Loading...</div>}>
                <OwnershipSection />
              </Suspense>
            </div>
          </div>
        </section>
      </div>

      {/* ══════════════════════════════════════════════════════════
          4. SECTION 2 — THE SOLUTION
          Strategy: Heading split text + card flip entrance
      ══════════════════════════════════════════════════════════ */}
      <section id="solution-overview" className="section section-bg-white-to-solution">
        <div className="container">
          {/* Animated heading */}
          <div
            ref={solutionHeadRef}
            className={`text-center reveal-on-scroll ${solutionHeadVisible ? 'is-visible' : ''}`}
            style={{ marginBottom: '32px' }}
          >
            <div className={`solution-pill badge-reveal ${solutionHeadVisible ? 'is-visible' : ''}`} style={{ marginBottom: '12px' }}>THE SOLUTION</div>
            <h2 className="h2 solution-heading">
              The <span className={`text-cyan text-underline-reveal ${solutionHeadVisible ? 'is-visible' : ''}`}>IoTank Solution</span>
            </h2>
            <span className={`line-draw-reveal ${solutionHeadVisible ? 'is-visible' : ''}`} />
          </div>

          {/* Image + text split + stagger feature grid */}
          <div className="solution-split-layout">
            {/* Left: Dashboard Image — blur-focus reveal */}
            <div className={`solution-image-side blur-focus-reveal ${solutionHeadVisible ? 'is-visible' : ''}`} style={{ transitionDelay: '0.2s' }}>
              <img
                src={dashboardMockup}
                alt="IoTank Intelligence Dashboard - Fuel Tank Monitoring and Analytics"
                className="solution-mockup-img hover-lift"
                loading="eager"
              />
            </div>

            {/* Right: Text + feature cards — stagger */}
            <div ref={solutionCardsRef} className="solution-content-side">
              <p className={`body-text reveal-on-scroll ${solutionCardsVisible ? 'is-visible' : ''}`} style={{ marginBottom: '10px', transitionDelay: '0.05s' }}>
                IoTank is Kenya's definitive answer to fuel losses, replacing manual dipping with a continuous industrial intelligence system.
              </p>
              <p className={`body-text reveal-on-scroll ${solutionCardsVisible ? 'is-visible' : ''}`} style={{ marginBottom: '28px', transitionDelay: '0.15s' }}>
                Instead of reacting after losses happen, you get real-time tank levels (±1mm precision), temperature-corrected volume, and AI procurement timing signals.
              </p>

              <div className={`solution-feature-grid stagger-container cards-animate-container ${solutionCardsVisible ? 'is-visible' : ''}`}>
                <div className="solution-feature-card precision stagger-item card-flip-in hover-lift">
                  <div className="feature-icon icon-pop"><FiTarget /></div>
                  <span className="feature-label">±1mm Precision</span>
                </div>
                <div className="solution-feature-card temp stagger-item card-flip-in hover-lift">
                  <div className="feature-icon icon-pop"><FiThermometer /></div>
                  <span className="feature-label">Temp Correction</span>
                </div>
                <div className="solution-feature-card ai stagger-item card-flip-in hover-lift">
                  <div className="feature-icon icon-pop"><FiZap /></div>
                  <span className="feature-label">AI Procurement</span>
                </div>
                <div className="solution-feature-card compliant stagger-item card-flip-in hover-lift">
                  <div className="feature-icon icon-pop"><FiShield /></div>
                  <span className="feature-label">EPRA Compliant</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          5. SECTION 3 — HOW IT WORKS
          Strategy: Heading kinetic-text + step cards with animated connector lines
      ══════════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="section section-bg-offwhite-to-white">
        <div className="container">
          <div
            ref={howWorksRef}
            className={`text-center reveal-on-scroll ${howWorksVisible ? 'is-visible' : ''}`}
            style={{ marginBottom: '32px' }}
          >
            <div className={`solution-pill badge-reveal ${howWorksVisible ? 'is-visible' : ''}`} style={{ background: 'rgba(0, 181, 216, 0.1)', border: '1px solid rgba(0, 181, 216, 0.2)', marginBottom: '12px' }}>HOW IT WORKS</div>
            <h2 className="h2 solution-heading">
              How <SplitText text="IoTank Works" isVisible={howWorksVisible} className="shimmer-gradient-text" />
            </h2>
            <p className={`body-text reveal-on-scroll ${howWorksVisible ? 'is-visible' : ''}`} style={{ color: '#94A3B8', transitionDelay: '0.3s' }}>No spreadsheets. No assumptions. No surprises.</p>
            <span className={`line-draw-reveal ${howWorksVisible ? 'is-visible' : ''}`} />
          </div>

          {/* Process steps — horizontal stagger */}
          <div className={`process-grid-modern stagger-h-container ${howWorksVisible ? 'is-visible' : ''}`}>
            {/* Step 1 */}
            <div className="process-step-card stagger-h-item hover-lift">
              <div className="step-icon-frame icon-pop glow-on-reveal"><FiDroplet /></div>
              <div className="step-meta">STEP 1</div>
              <h3 className="step-title-bold">Tank Sensors</h3>
              <p className="step-description-text">Industrial ultrasonic sensors capture fuel level and temperature in real time.</p>
              <a href="#hardware" className="step-link-modern">View Hardware →</a>
            </div>

            <div className="step-connector stagger-h-item step-connector-animated" />

            {/* Step 2 */}
            <div className="process-step-card stagger-h-item hover-lift">
              <div className="step-icon-frame icon-pop glow-on-reveal"><FiCloud /></div>
              <div className="step-meta">STEP 2</div>
              <h3 className="step-title-bold">Secure Cloud</h3>
              <p className="step-description-text">Encrypted synchronization via our secure cloud infrastructure ensures data continuity and backup.</p>
              <a href="#security" className="step-link-modern">Security Architecture →</a>
            </div>

            <div className="step-connector stagger-h-item step-connector-animated" />

            {/* Step 3 */}
            <div className="process-step-card stagger-h-item hover-lift">
              <div className="step-icon-frame icon-pop glow-on-reveal"><FiActivity /></div>
              <div className="step-meta">STEP 3</div>
              <h3 className="step-title-bold">AI Advisory</h3>
              <p className="step-description-text">Consumption patterns analyzed against market price feeds to generate buy/wait signals.</p>
              <a href="#ai" className="step-link-modern">How AI works →</a>
            </div>

            <div className="step-connector stagger-h-item step-connector-animated" />

            {/* Step 4 */}
            <div className="process-step-card stagger-h-item hover-lift">
              <div className="step-icon-frame icon-pop glow-on-reveal"><FiLayout /></div>
              <div className="step-meta">STEP 4</div>
              <h3 className="step-title-bold">Actionable Dashboard</h3>
              <p className="step-description-text">Clear alerts. Compliance reports. Theft detection. Procurement guidance.</p>
              <a href="#dashboard" className="step-link-modern">See Dashboard →</a>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          6. INTERACTIVE DASHBOARD SIMULATION
          Strategy: Blur-focus reveal
      ══════════════════════════════════════════════════════════ */}
      <div
        ref={dashboardSimRef}
        className={`blur-focus-reveal ${dashboardSimVisible ? 'is-visible' : ''}`}
      >
        <Suspense fallback={<div className="section-loader">Loading Dashboard...</div>}>
          <InteractiveDashboardSnippet />
        </Suspense>
      </div>

      {/* ══════════════════════════════════════════════════════════
          7. SECURITY SECTION
          Strategy: Reveal scale
      ══════════════════════════════════════════════════════════ */}
      <Suspense fallback={<div className="section-loader">Loading Security...</div>}>
        <SecuritySection />
      </Suspense>

      {/* ══════════════════════════════════════════════════════════
          8. SECTION 4 — RISK FACTORS (Profit Killers)
          Strategy: Reveal + stagger cards
      ══════════════════════════════════════════════════════════ */}
      <div ref={solutionRef} className={`reveal-on-scroll ${solutionVisible ? 'is-visible' : ''}`}>
        <section id="risks" className="section section-bg-light-gray">
          <div className="container">
            <ProfitKillers />
          </div>
        </section>
      </div>

      {/* ══════════════════════════════════════════════════════════
          9. SECTION 5 — AUTHORITY & COMPLIANCE
          Strategy: Flip reveal from bottom
      ══════════════════════════════════════════════════════════ */}
      <div ref={excellenceRef} className={`reveal-scale ${excellenceVisible ? 'is-visible' : ''}`}>
        <section className="section section-bg-dark-navy">
          <Suspense fallback={<div className="section-loader">Loading...</div>}>
            <ExcellenceSection />
          </Suspense>
        </section>
      </div>

      {/* ══════════════════════════════════════════════════════════
          10. COMPLIANCE SECTION
          Strategy: Stagger left/right
      ══════════════════════════════════════════════════════════ */}
      <div
        ref={complianceRef}
        className={`reveal-on-scroll ${complianceVisible ? 'is-visible' : ''}`}
      >
        <section id="compliance" className="section section-bg-white">
          <div className="container">
            <div className="text-center mb-8">
              <div className={`regulatory-pill badge-reveal ${complianceVisible ? 'is-visible' : ''}`}>REGULATORY COMPLIANCE</div>
              <h2 className="h2 regulatory-heading">
                Built for{' '}
                <span className={`regulatory-highlight text-underline-reveal ${complianceVisible ? 'is-visible' : ''}`}>Regulatory &amp; Industrial</span>
                {' '}Environments
              </h2>
              <p className="body-text regulatory-sub">IoTank aligns with EPRA, EHS, and digital audit trail frameworks.</p>
              <span className={`line-draw-reveal ${complianceVisible ? 'is-visible' : ''}`} />
            </div>
            <Suspense fallback={<div className="section-loader">Loading Compliance...</div>}>
              <ComplianceOverview />
            </Suspense>
          </div>
        </section>
      </div>

      {/* ══════════════════════════════════════════════════════════
          11. SECTION 6 — AI INTELLIGENCE ENGINE
          Strategy: Zoom reveal + counter stats
      ══════════════════════════════════════════════════════════ */}
      <div
        ref={aiSectionRef}
        className={`reveal-zoom ${aiSectionVisible ? 'is-visible' : ''}`}
      >
        <section id="ai-intelligence" className="section ai-section-dark">
          <div className="container">
            <div className="text-center">
              <div className={`ai-pill badge-reveal ${aiSectionVisible ? 'is-visible' : ''}`}>AI INTELLIGENCE ENGINE</div>
              <h2 className="ai-section-heading">
                Your Data, in{' '}
                <span className={`ai-heading-cyan shimmer-gradient-text ${aiSectionVisible ? 'is-visible' : ''}`}>Plain English</span>
              </h2>
              <p className="ai-section-sub">Ask IoTank AI anything. No training required.</p>
            </div>

            {/* Chat Terminal Card */}
            <div className={`ai-terminal-card hover-lift ${aiSectionVisible ? 'card-flip-in is-visible' : 'card-flip-in'}`} style={{ transitionDelay: '0.25s' }}>
              <div className="ai-terminal-bar">
                <div className="ai-traffic-lights">
                  <span className="tl-red"></span>
                  <span className="tl-yellow"></span>
                  <span className="tl-green"></span>
                </div>
                <span className="ai-terminal-title">IoTank Fuel Intelligence Hub</span>
                <span className="ai-live-dot"><span className="live-pulse"></span>Live</span>
              </div>

              <div className="ai-chat-body">
                <div className="ai-chat-row user-row">
                  <div className="ai-bubble user-bubble">&ldquo;Should I buy today?&rdquo;</div>
                </div>
                <div className="ai-chat-row ai-row">
                  <div className="ai-avatar"><FiMessageSquare size={16} /></div>
                  <div className="ai-bubble ai-bubble-response">
                    &ldquo;Yes. Consumption is high and EPRA price increase is projected for Sunday. Buying now saves you <span className="ai-ksh-highlight">Ksh 185,000</span>.&rdquo;
                  </div>
                </div>
              </div>

              <div className="ai-terminal-footer">
                Powered by IoTank&apos;s Fuel Intelligence Engine &middot; Updated every 15 minutes
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ══════════════════════════════════════════════════════════
          12. SECTION 7 — PRICING
          Strategy: Cards flip in with stagger
      ══════════════════════════════════════════════════════════ */}
      <div
        ref={pricingRef}
        className={`reveal-on-scroll ${pricingVisible ? 'is-visible' : ''}`}
      >
        <section id="pricing" className="section section-bg-offwhite-to-white">
          <div className="container">
            <div className="pricing-header-modern">
              <div className={`pricing-pill badge-reveal ${pricingVisible ? 'is-visible' : ''}`}>PRICING</div>
              <h2 className="pricing-title-modern">
                Simple &{' '}
                <span className={`text-underline-reveal ${pricingVisible ? 'is-visible' : ''}`}>Transparent</span>
              </h2>
            </div>

            <div className={`pricing-grid-modern cards-animate-container ${pricingVisible ? 'is-visible' : ''}`}>
              {/* CARD 1: PLATFORM */}
              <div className="pricing-card-modern software card-flip-in hover-lift">
                <span className="pricing-badge-modern">SOFTWARE</span>
                <div className="pricing-label-modern">WEB PLATFORM</div>
                <h3 className="pricing-value-modern">Usage-Based</h3>
                <p className="pricing-period-modern">Billed Monthly</p>
                <p className="pricing-desc-modern">
                  Complete dashboard, analytics, AI insights. No fixed tiers.
                  Billed based on actual monitored activity.
                </p>
                <div className="pricing-features-modern">
                  <div className="pricing-feature-modern"><FiCheckCircle /> Real-time Monitoring</div>
                  <div className="pricing-feature-modern"><FiCheckCircle /> AI Procurement Alerts</div>
                  <div className="pricing-feature-modern"><FiCheckCircle /> Compliance Reporting</div>
                </div>
                <button className="pricing-btn-modern primary" onClick={() => window.location.href = 'mailto:iotank.com@gmail.com'}>
                  Get Started
                </button>
              </div>

              {/* CARD 2: HARDWARE */}
              <div className="pricing-card-modern hardware card-flip-in hover-lift">
                <span className="pricing-badge-modern">HARDWARE</span>
                <div className="pricing-label-modern">HARDWARE PACKAGE</div>
                <div className="hardware-price-wrap">
                  <h3 className="pricing-value-modern">
                    <CounterStat target={35} suffix="k" />
                  </h3>
                  <span className="hardware-price-unit">Ksh</span>
                </div>
                <p className="pricing-period-modern">One-Time</p>
                <p className="pricing-desc-modern">
                  Industrial sensors, controller, enclosure.
                  Software auto-activated.
                </p>
                <div className="pricing-features-modern">
                  <div className="pricing-feature-modern"><FiCheckCircle /> Ultrasonic Precision</div>
                  <div className="pricing-feature-modern"><FiCheckCircle /> Thermal Correction</div>
                  <div className="pricing-feature-modern"><FiCheckCircle /> 24hr Installation</div>
                </div>
                <button className="pricing-btn-modern outline" onClick={() => window.location.href = 'mailto:iotank.com@gmail.com'}>
                  Order Hardware
                </button>
              </div>
            </div>

            <p className="pricing-footer-note">
              Payback period: ~8 days (average site).
            </p>
          </div>
        </section>
      </div>

      {/* ══════════════════════════════════════════════════════════
          13. TESTIMONIAL CAROUSEL
          Strategy: Reveal scale
      ══════════════════════════════════════════════════════════ */}
      <div ref={testimonialRef} className={`reveal-scale ${testimonialVisible ? 'is-visible' : ''}`}>
        <Suspense fallback={<div className="section-loader">Loading Testimonials...</div>}>
          <TestimonialCarousel />
        </Suspense>
      </div>

      {/* ══════════════════════════════════════════════════════════
          14. SOCIAL PROOF BAR (Animated Counters)
      ══════════════════════════════════════════════════════════ */}
      <SocialProofBar />

      {/* ══════════════════════════════════════════════════════════
          15. DECISION PATHS
          Strategy: Reveal left/right
      ══════════════════════════════════════════════════════════ */}


      {/* ══════════════════════════════════════════════════════════
          16. FAQ SECTION
          Strategy: Stagger reveal
      ══════════════════════════════════════════════════════════ */}
      <div className="section-bg-offwhite-to-white">
        <Suspense fallback={<div className="section-loader">Loading FAQ...</div>}>
          <FAQSection />
        </Suspense>
      </div>

      {/* ══════════════════════════════════════════════════════════
          17. PARTNERS & CLIENTS
      ══════════════════════════════════════════════════════════ */}
      <Suspense fallback={<div className="section-loader">Loading Partners...</div>}>
        <PartnersClientsSection />
      </Suspense>

      {/* ══════════════════════════════════════════════════════════
          18. LEAD MAGNET NEWSLETTER
          Strategy: Blur focus reveal
      ══════════════════════════════════════════════════════════ */}
      <div ref={newsletterRef} className={`blur-focus-reveal ${newsletterVisible ? 'is-visible' : ''}`}>
        <Suspense fallback={<div className="section-loader">Loading Newsletter...</div>}>
          <LeadMagnetNewsletter />
        </Suspense>
      </div>

      {/* ══════════════════════════════════════════════════════════
          19. FINAL CTA
          Strategy: Zoom in + gradient shimmer heading
      ══════════════════════════════════════════════════════════ */}
      <div ref={finalCTARef} className={`reveal-zoom ${finalCTAVisible ? 'is-visible' : ''}`}>
        <section className="final-cta-modern">
          <div className="container">
            <div className={`cta-pill-modern badge-reveal ${finalCTAVisible ? 'is-visible' : ''}`}>GET STARTED TODAY</div>
            <h2 className="cta-title-modern">
              Start managing fuel as a <span className="shimmer-gradient-text">strategic asset</span>
            </h2>
            <p className={`cta-desc-modern reveal-on-scroll ${finalCTAVisible ? 'is-visible' : ''}`} style={{ transitionDelay: '0.2s' }}>
              Stop guessing. Start knowing. Join the future of fuel intelligence today.
            </p>
            <div className={`cta-actions-modern stagger-container ${finalCTAVisible ? 'is-visible' : ''}`}>
              <button className="btn-cta-primary stagger-item hover-lift" onClick={handleGetStarted}>Get Started Now</button>
              <button className="btn-cta-outline stagger-item hover-lift" onClick={() => setIsDocViewerOpen(true)}>View Documentation</button>
            </div>
          </div>
          <div className="cta-glow-effect"></div>
        </section>
      </div>

      {/* ══════════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════════ */}
      <footer className="footer-landing">
        <div className="container footer-grid">
          <div className="footer-brand">
            <div className="brand">
              <div className="footer-logo-frame">
                <img src={brandMark} alt="IoTank Brandmark" className="footer-logo-img" />
              </div>
              <span>Joe Engineering</span>
            </div>
            <p className="footer-company-desc">Pioneering Industrial IoT &amp; AI for the fuel energy sector in Kenya.</p>
            <p className="footer-location-text">Headquartered in Nairobi, Kenya.</p>
            <div className="footer-trust-badges">
              <span className="trust-pill shadow-soft">Registered in Kenya</span>
              <span className="trust-pill shadow-soft">Serving Retail, Fleet &amp; Infrastructure</span>
              <span className="trust-pill shadow-soft">Nairobi | Mombasa | Nakuru</span>
            </div>
          </div>

          <div>
            <h4 className="footer-title">Platform</h4>
            <ul className="footer-links">
              <li><a href="#solution-overview">IoTank System</a></li>
              <li><a href="#how-it-works">Hardware Device</a></li>
              <li><a href="#ai-intelligence">AI Engine</a></li>
              <li><a href="#pricing">Deployment &amp; Install</a></li>
              <li><a href="#compliance">Security Architecture</a></li>
            </ul>
          </div>

          <div>
            <h4 className="footer-title">Compliance</h4>
            <ul className="footer-links">
              <li><a href="#compliance">EPRA Standards</a></li>
              <li><a href="#compliance">Environmental Monitoring</a></li>
              <li><a href="#compliance">Audit Reporting</a></li>
              <li><a href="#ai-intelligence">AI Governance</a></li>
              <li><a href="#compliance">Safety &amp; Isolation</a></li>
            </ul>
          </div>

          <div>
            <h4 className="footer-title">Resources</h4>
            <ul className="footer-links">
              <li><a href="#how-it-works">How It Works</a></li>
              <li><button className="link-btn" onClick={() => setIsDocViewerOpen(true)}>Technical Docs</button></li>
              <li><a href="#!">Case Studies</a></li>
              <li><button className="link-btn" onClick={() => setIsLossCalcOpen(true)}>Fuel Risk Calculator</button></li>
              <li><a href="#!">Updates</a></li>
            </ul>
          </div>

          <div>
            <h4 className="footer-title">Support</h4>
            <ul className="footer-links">
              <li><a href="https://wa.me/254111746901" target="_blank" rel="noopener noreferrer">WhatsApp Support</a></li>
              <li><a href="mailto:iotank.com@gmail.com">iotank.com@gmail.com</a></li>
              <li><a href="tel:+254111746901">+254 111 746 901</a></li>
              <li><a href="#!">Help Center</a></li>
              <li><a href="#!">System Status</a></li>
            </ul>
          </div>
        </div>

        <div className="container">
          <div className="footer-infrastructure-bar">
            <div className="footer-infra-left">
              <span>IoTank Platform v2.0.0</span>
              <span>Firmware Baseline v2.1.4-Stable</span>
              <span>System Uptime: 99.98%</span>
            </div>
            <div className="footer-infra-right">
              <span>Powered by Secure Cloud Infrastructure</span>
              <span>AES-256 Encryption</span>
              <span>Built for EPRA Compliance</span>
            </div>
          </div>
        </div>

        <div className="container footer-bottom">
          <div className="footer-bottom-main">
            <p>&copy; {new Date().getFullYear()} Joe Engineering Ltd. All rights reserved.</p>
            <div className="footer-social-links">
              <a href="https://x.com/josephvundi16" target="_blank" rel="noopener noreferrer" className="social-icon-btn" title="X (Twitter) @josephvundi16"><FiTwitter /></a>
              <a href="https://www.linkedin.com/in/joseph-vundi-engineering" target="_blank" rel="noopener noreferrer" className="social-icon-btn" title="LinkedIn"><FiLinkedin /></a>
              <a href="https://www.facebook.com/joseph.vundi.180" target="_blank" rel="noopener noreferrer" className="social-icon-btn" title="Facebook"><FiFacebook /></a>
              <a href="mailto:iotank.com@gmail.com" className="social-icon-btn" title="Email Customer Support"><FiMail /></a>
            </div>
          </div>
        </div>
      </footer>

      {/* AI Live Chat */}
      <LiveChat />

      {/* Custom Scroll Handle */}
      <div
        ref={handleRef}
        className={`scroll-top-handle ${scrolled ? 'visible' : ''} ${isDragging ? 'dragging' : ''}`}
        style={{ transform: 'translateX(0)' }}
        onMouseDown={handleMouseDown}
        title="Scroll Handle"
      >
        <div className="handle-grip">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  );
};
