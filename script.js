// ==================================================================
// PNP website — interactive behaviors
// Shared helpers are hoisted to module scope so individual feature
// blocks stay small and the DOMContentLoaded handler stays composable.
// ==================================================================

// Bounded segments prevent the catastrophic backtracking sonar warns about
// (sonarjs/slow-regex). Real validation happens server-side in /api/subscribe.
const EMAIL_RE = /^[^\s@]{1,254}@[^\s@]{1,253}\.[^\s@]{1,253}$/;
const WISHLIST_KEY = "pnp:wishlist";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// ----- Wishlist data layer (hoisted so it doesn't bulk up the init handler) -----

const WISHLIST_CHANGE_EVENT = "wishlist:change";

function readWishlist() {
  try {
    const raw = localStorage.getItem(WISHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (storageErr) {
    if (window.console) window.console.warn("[wishlist] read failed:", storageErr.message);
    return [];
  }
}

function writeWishlist(items) {
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(WISHLIST_CHANGE_EVENT, { detail: { items } }));
}

function itemKey(item) {
  return `${item.name}|${item.image}`;
}

function inWishlist(item) {
  return readWishlist().some((i) => itemKey(i) === itemKey(item));
}

function toggleWishlist(item) {
  const list = readWishlist();
  const idx = list.findIndex((i) => itemKey(i) === itemKey(item));
  if (idx >= 0) list.splice(idx, 1);
  else list.push(item);
  writeWishlist(list);
  return idx < 0; // true if added
}

// Non-cryptographic randomness — used for visual shuffles, confetti positions,
// and the 404 page's runaway plushie pick. Never used for tokens, IDs, or auth.
// sonarjs/pseudo-random is safe to ignore in this scope; we encapsulate the
// call so the suppression lives in one place.
function randomFloat() {
  // eslint-disable-next-line sonarjs/pseudo-random -- visual effects only
  return Math.random();
}

function randomInt(maxExclusive) {
  return Math.floor(randomFloat() * maxExclusive);
}

// Force a layout flush so a removed CSS animation can re-trigger.
// Reading getBoundingClientRect() has the same reflow side-effect as
// reading offsetWidth, without sonarjs/void-use complaining.
function forceReflow(el) {
  el.getBoundingClientRect();
}

// The DOMContentLoaded handler below orchestrates ~15 independent feature
// blocks (carousel, wishlist, newsletter, drop countdown, etc.). Its
// cognitive complexity reflects this orchestration role rather than tangled
// logic — each block is self-contained and reads top-to-bottom. A future
// refactor should split this single file into ES modules with one feature
// per file; until then we accept the structural complexity.
// eslint-disable-next-line sonarjs/cognitive-complexity -- bootstrap orchestrator
document.addEventListener("DOMContentLoaded", async () => {
  // --- Sanity hydration (runs first so the rest of the init sees real data) ---
  // No-op if Sanity isn't configured (window.PNP_CONFIG.sanityProjectId empty).
  if (window.PNP_SANITY && window.PNP_SANITY.isConfigured()) {
    try {
      await Promise.all([hydrateAdoptFromSanity(), hydrateNextDropFromSanity()]);
    } catch (err) {
      // Hydration is best-effort: if Sanity is unreachable or returns malformed
      // data, we silently fall back to the hardcoded HTML. Surface to the
      // browser console for debugging only.
      if (typeof window !== "undefined" && window.console) {
        window.console.warn("[sanity] hydration failed:", err);
      }
    }
  }

  async function hydrateAdoptFromSanity() {
    const grid = document.querySelector(".adopt-grid");
    if (!grid) return;
    let plushies;
    try {
      plushies = await window.PNP_SANITY.fetchPlushies();
    } catch (fetchErr) {
      if (window.console) window.console.warn("[sanity] adopt fetch failed:", fetchErr);
      return;
    }
    if (!Array.isArray(plushies) || plushies.length === 0) return;

    const formatDate = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    };

    const STATUS = {
      available: { tag: "Available", classMod: "" },
      adopted: { tag: "Adopted", classMod: "is-adopted" },
      "coming-soon": { tag: "Coming Soon", classMod: "" },
      "on-hold": { tag: "On Hold", classMod: "" },
    };

    const snipcartReady = Boolean(window.PNP_CONFIG?.snipcartApiKey);

    // Helper: render the CTA. Avoids a nested ternary (sonar S3358).
    const renderCta = ({ isAdopted, canCart, itemId, plushie, imgUrl }) => {
      if (isAdopted) {
        return `<a href="#" class="btn btn-solid adopt-cta" aria-disabled="true">No longer available</a>`;
      }
      if (canCart) {
        const desc = escapeHTML((plushie.personality || "").slice(0, 200));
        return `<button type="button" class="snipcart-add-item btn btn-solid adopt-cta"
                 data-item-id="${escapeHTML(itemId)}"
                 data-item-name="${escapeHTML(plushie.name || "")}"
                 data-item-price="${Number(plushie.price)}"
                 data-item-url="/adopt.html"
                 data-item-image="${escapeHTML(imgUrl)}"
                 data-item-description="${desc}"
               >Adopt ${escapeHTML(plushie.name || "")}</button>`;
      }
      return `<a href="store.html" class="btn btn-solid adopt-cta">Adopt ${escapeHTML(plushie.name || "")}</a>`;
    };

    // Helper: render the price line. Avoids a nested ternary.
    const renderPriceLine = (plushie, isAdopted) => {
      if (isAdopted) {
        return `<p class="price">Adopted <small>thank you for the kind home</small></p>`;
      }
      if (plushie.price != null) {
        return `<p class="price">$${Number(plushie.price)} <small>adoption fee</small></p>`;
      }
      return "";
    };

    grid.innerHTML = plushies
      .map((p) => {
        const status = STATUS[p.status] || STATUS.available;
        const isAdopted = p.status === "adopted";
        const cardClass = `adopt-card grid-item ${status.classMod}`.trim();
        const imgUrl =
          window.PNP_SANITY.imageUrl(p.image, { w: 600, h: 750, fit: "crop", q: 80 }) || "";
        const itemId = p.snipcartId || p.slug;
        const canCart = snipcartReady && !isAdopted && itemId && p.price != null;
        const cta = renderCta({ isAdopted, canCart, itemId, plushie: p, imgUrl });
        const priceLine = renderPriceLine(p, isAdopted);

        const specs = [];
        if (p.snack)
          specs.push(
            `<li><span class="label">Snack of choice</span><span class="value">${escapeHTML(p.snack)}</span></li>`,
          );
        if (p.stitchedOn)
          specs.push(
            `<li><span class="label">Stitched on</span><span class="value">${escapeHTML(formatDate(p.stitchedOn))}</span></li>`,
          );
        if (typeof p.weighted === "boolean") {
          const grams = Number(p.weightGrams);
          const weightSuffix = Number.isFinite(grams) && grams > 0 ? ` &middot; ${grams}g` : "";
          const w = p.weighted ? `Yes${weightSuffix}` : "No";
          specs.push(`<li><span class="label">Weighted</span><span class="value">${w}</span></li>`);
        }

        const meta = [];
        if (p.pronouns) meta.push(escapeHTML(p.pronouns));
        if (p.collectionName) meta.push(escapeHTML(p.collectionName));

        return `
          <article class="${cardClass}" data-category="${escapeHTML(p.collectionSlug || "")}">
            <span class="status-tag">${escapeHTML(status.tag)}</span>
            <div class="photo-wrap">
              ${imgUrl ? `<img src="${imgUrl}" loading="lazy" decoding="async" alt="${escapeHTML(p.name || "Plushie")}" />` : ""}
            </div>
            <h4 class="name">${escapeHTML(p.name || "")}</h4>
            ${meta.length ? `<p class="pronouns">${meta.join(" &middot; ")}</p>` : ""}
            ${p.personality ? `<p class="personality">${escapeHTML(p.personality)}</p>` : ""}
            ${specs.length ? `<ul class="specs">${specs.join("")}</ul>` : ""}
            ${priceLine}
            ${cta}
          </article>`;
      })
      .join("");
  }

  async function hydrateNextDropFromSanity() {
    const dropEl = document.querySelector(".next-drop");
    if (!dropEl) return;
    let drop;
    try {
      drop = await window.PNP_SANITY.fetchNextDrop();
    } catch (fetchErr) {
      if (window.console) window.console.warn("[sanity] drop fetch failed:", fetchErr);
      return;
    }
    if (!drop || !drop.dropAt) return;

    const friendly =
      drop.humanMeta ||
      new Date(drop.dropAt).toLocaleString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

    dropEl.setAttribute("data-drop-at", drop.dropAt);
    dropEl.setAttribute("data-drop-name", drop.name || "Next Drop");
    dropEl.setAttribute("data-drop-meta", friendly);
    if (drop.eyebrow) {
      const eyebrow = dropEl.querySelector(".eyebrow");
      if (eyebrow) eyebrow.textContent = drop.eyebrow;
    }
  }

  // --- Carousel ---
  const carousel = document.querySelector(".carousel");
  if (carousel) {
    // --- Data and Setup ---
    const allPhotos = Array.from({ length: 76 }, (_, i) => `${i + 1}.webp`);

    // Shuffle and pick 15 random photos (visual-only — see randomInt)
    for (let i = allPhotos.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [allPhotos[i], allPhotos[j]] = [allPhotos[j], allPhotos[i]];
    }
    const photos = allPhotos.slice(0, 15);

    carousel.innerHTML = "";
    const carouselTrack = document.createElement("div");
    carouselTrack.classList.add("carousel-track");
    carousel.appendChild(carouselTrack);

    const createCarouselItem = (photo) => {
      const item = document.createElement("div");
      item.classList.add("carousel-item");

      const inner = document.createElement("div");
      inner.classList.add("carousel-item-inner");

      const img = document.createElement("img");
      img.src = `Photos/webp/${photo}`;
      img.alt = `Plushie ${photo.replace(".webp", "")}`;
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      const p = document.createElement("p");
      p.textContent = `Plushie #${photo.replace(".webp", "")}`;

      inner.appendChild(img);
      inner.appendChild(p);
      item.appendChild(inner);

      inner.addEventListener("click", () => {
        if (!hasDragged && typeof window.openLightbox === "function") {
          const alt = `Plushie ${photo.replace(".webp", "")}`;
          window.openLightbox(`Photos/webp/${photo}`, alt);
        }
      });

      return item;
    };

    // Create clones for infinite loop
    photos.forEach((photo) => carouselTrack.appendChild(createCarouselItem(photo)));
    photos.forEach((photo) => carouselTrack.appendChild(createCarouselItem(photo)));
    photos.forEach((photo) => carouselTrack.appendChild(createCarouselItem(photo)));

    // --- Styling ---
    const oldStyle = document.head.querySelector("style");
    if (oldStyle) oldStyle.remove();
    const style = document.createElement("style");
    style.innerHTML = `
        .carousel { 
            overflow: hidden; 
            position: relative; 
            cursor: grab; 
            -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent); 
            mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent); 
        }
        .carousel.grabbing { cursor: grabbing; }
        .carousel-track { display: flex; align-items: center; padding: 4.5rem 0; gap: 2.25rem; }
        .carousel-item { 
            flex-shrink: 0; 
            transition: transform 0.1s ease-out, opacity 0.1s ease-out, box-shadow 0.4s ease !important; 
            transform-origin: center center; 
            will-change: transform, opacity; 
        }
    `;
    document.head.appendChild(style);

    // --- State and Animation Logic ---
    let isDown = false,
      hasDragged = false,
      isPaused = false;
    let startX,
      scrollLeft,
      velocity = 0,
      animationFrame;
    const friction = 0.95,
      scrollSpeed = 1.2;

    // We need to wait for layout to measure correctly
    setTimeout(() => {
      let items = Array.from(carouselTrack.children);
      const oneThirdWidth = carouselTrack.scrollWidth / 3;
      carousel.scrollLeft = oneThirdWidth;

      function updateItems() {
        const carouselRect = carousel.getBoundingClientRect();
        const carouselCenter = carouselRect.left + carouselRect.width / 2;

        items.forEach((item) => {
          const itemRect = item.getBoundingClientRect();
          const itemCenter = itemRect.left + itemRect.width / 2;
          const distanceFromCenter = Math.abs(carouselCenter - itemCenter);

          const maxDistance = carouselRect.width / 1.2;
          let progress = 1 - distanceFromCenter / maxDistance;
          progress = Math.max(0, Math.min(1, progress));

          // Coverflow: scale and opacity
          const scale = 0.75 + progress * 0.35; // Scale from 0.75 to 1.1
          const opacity = 0.4 + progress * 0.6; // Opacity from 0.4 to 1.0

          // Conveyor Belt: tilt on drag
          let tilt = 0;
          if (Math.abs(velocity) > 0.1 || isDown) {
            tilt = velocity * 0.8;
            tilt = Math.max(-15, Math.min(15, tilt));
          }

          item.style.transform = `scale(${scale}) perspective(600px) rotateY(${tilt}deg)`;
          item.style.opacity = opacity;
          item.style.zIndex = Math.round(progress * 100);
        });
      }

      function animationLoop() {
        if (!isPaused && !isDown) {
          carousel.scrollLeft += scrollSpeed;
        }
        if (Math.abs(velocity) > 0.5 && !isDown) {
          carousel.scrollLeft -= velocity;
          velocity *= friction;
        } else if (!isDown) {
          velocity = 0;
        }

        if (carousel.scrollLeft >= oneThirdWidth * 2) {
          carousel.scrollLeft -= oneThirdWidth;
        } else if (carousel.scrollLeft <= 0) {
          carousel.scrollLeft += oneThirdWidth;
        }

        updateItems();
        animationFrame = requestAnimationFrame(animationLoop);
      }

      // --- Event Listeners ---
      let lastX, lastTime;

      carousel.addEventListener("mousedown", (e) => {
        isDown = true;
        hasDragged = false;
        velocity = 0;
        carousel.classList.add("grabbing");
        startX = e.pageX - carousel.offsetLeft;
        scrollLeft = carousel.scrollLeft;
        lastX = e.pageX;
        lastTime = Date.now();
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(animationLoop);
      });

      carousel.addEventListener("mouseenter", () => (isPaused = true));
      carousel.addEventListener("mouseleave", () => {
        isDown = false;
        isPaused = false;
        carousel.classList.remove("grabbing");
      });

      carousel.addEventListener("mouseup", () => {
        isDown = false;
        carousel.classList.remove("grabbing");
      });

      carousel.addEventListener("mousemove", (e) => {
        if (!isDown) return;
        hasDragged = true;
        e.preventDefault();
        const x = e.pageX - carousel.offsetLeft;
        const walk = x - startX;
        carousel.scrollLeft = scrollLeft - walk;

        const now = Date.now();
        const dt = now - lastTime;
        if (dt > 15) {
          const distance = e.pageX - lastX;
          velocity = (distance / dt) * 15;
          lastTime = now;
          lastX = e.pageX;
        }
      });

      // Touch support
      carousel.addEventListener(
        "touchstart",
        (e) => {
          isDown = true;
          velocity = 0;
          carousel.classList.add("grabbing");
          startX = e.touches[0].pageX - carousel.offsetLeft;
          scrollLeft = carousel.scrollLeft;
          lastX = e.touches[0].pageX;
          lastTime = Date.now();
          cancelAnimationFrame(animationFrame);
          animationFrame = requestAnimationFrame(animationLoop);
        },
        { passive: true },
      );

      carousel.addEventListener("touchend", () => {
        isDown = false;
        carousel.classList.remove("grabbing");
      });

      carousel.addEventListener(
        "touchmove",
        (e) => {
          if (!isDown) return;
          const x = e.touches[0].pageX - carousel.offsetLeft;
          const walk = x - startX;
          carousel.scrollLeft = scrollLeft - walk;

          const now = Date.now();
          const dt = now - lastTime;
          if (dt > 15) {
            const distance = e.touches[0].pageX - lastX;
            velocity = (distance / dt) * 15;
            lastTime = now;
            lastX = e.touches[0].pageX;
          }
        },
        { passive: true },
      );

      animationLoop();
    }, 100);
  }

  // --- Scroll-triggered Animations ---
  const animatedSections = document.querySelectorAll(".animated-section");
  if (animatedSections.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    animatedSections.forEach((section) => {
      observer.observe(section);
    });
  }

  // --- Category Filtering ---
  const filterBtns = document.querySelectorAll(".filter-btn");
  const gridItems = document.querySelectorAll(".grid-item");
  if (filterBtns.length > 0 && gridItems.length > 0) {
    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const filterValue = btn.getAttribute("data-filter");
        gridItems.forEach((item) => {
          if (filterValue === "all" || item.getAttribute("data-category") === filterValue) {
            item.style.display = "block";
          } else {
            item.style.display = "none";
          }
        });
      });
    });
  }

  // --- Interactive Words (Fat Word) ---
  const headingsToInterlace = document.querySelectorAll(
    ".hero-header .hero-text h2, .hero-header .hero-text h3, .hero-header .hero-text .hero-byline, " +
      ".new-arrivals h2, .new-arrivals h4, .featured-text h2",
  );
  headingsToInterlace.forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words
      .map((word) => `<span class="fat-word">${escapeHTML(word)}</span>`)
      .join(" ");
  });

  // --- Reveal Footer ---
  const footer = document.querySelector("footer");
  if (footer) {
    const wrapper = document.createElement("div");
    wrapper.className = "site-content-wrapper";
    const children = Array.from(document.body.children);
    children.forEach((child) => {
      if (child.tagName !== "FOOTER" && child.tagName !== "SCRIPT") {
        wrapper.appendChild(child);
      }
    });
    document.body.insertBefore(wrapper, footer);
    document.body.classList.add("reveal-footer-active");
    footer.classList.add("reveal-footer");

    function updateFooter() {
      wrapper.style.marginBottom = footer.offsetHeight + "px";
    }
    window.addEventListener("resize", updateFooter);
    window.addEventListener("load", updateFooter);
    setTimeout(updateFooter, 100);
    updateFooter();
  }

  // --- Lightbox ---
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxClose = document.querySelector(".lightbox-close");

  if (lightbox && lightboxImg && lightboxClose) {
    window.openLightbox = (imgSrc, imgAlt = "Plushie photo") => {
      lightboxImg.src = imgSrc;
      lightboxImg.alt = imgAlt;
      lightbox.hidden = false;
      lightbox.classList.add("active");
    };

    const closeLightbox = () => {
      lightbox.classList.remove("active");
      setTimeout(() => {
        lightbox.hidden = true;
        lightboxImg.alt = "";
      }, 300);
    };

    lightboxClose.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) {
        closeLightbox();
      }
    });
  }

  // --- Background Confetti (toned-down, brand-palette pastel motes) ---
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!prefersReducedMotion) {
    const canvas = document.createElement("canvas");
    canvas.id = "confetti-canvas";
    Object.assign(canvas.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "-1",
      opacity: "0.55",
    });

    const wrapper = document.querySelector(".site-content-wrapper");
    if (wrapper) {
      wrapper.appendChild(canvas);
    } else {
      document.body.style.position = "relative";
      document.body.appendChild(canvas);
    }

    const ctx = canvas.getContext("2d");
    let width, height;

    function resize() {
      width = window.innerWidth;
      height = Math.max(document.body.scrollHeight, document.body.offsetHeight);
      canvas.width = width;
      canvas.height = height;
    }
    window.addEventListener("resize", resize);
    window.addEventListener("load", resize);
    setTimeout(resize, 500);
    resize();

    // Soft brand-palette colors
    const palette = [
      "rgba(162, 213, 198, 0.75)", // mint
      "rgba(232, 141, 158, 0.65)", // pink
      "rgba(255, 212, 184, 0.75)", // peach
      "rgba(245, 197, 205, 0.65)", // pink-soft
    ];

    class Mote {
      constructor() {
        this.reset(true);
      }
      reset(initial = false) {
        this.x = randomFloat() * width;
        this.y = initial ? randomFloat() * height : window.scrollY - 40;
        this.speed = 0.25 + randomFloat() * 0.55; // much slower
        this.size = 4 + randomFloat() * 7;
        this.drift = (randomFloat() - 0.5) * 0.6;
        this.driftPhase = randomFloat() * Math.PI * 2;
        this.color = palette[randomInt(palette.length)];
      }
      update() {
        this.y += this.speed;
        this.x += Math.sin((this.y + this.driftPhase * 100) / 60) * this.drift;
        if (this.y > window.scrollY + height + 60) this.reset();
      }
      draw() {
        ctx.beginPath();
        ctx.fillStyle = this.color;
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Density scales with viewport size, capped at 30
    const motes = Array.from(
      { length: Math.min(30, Math.floor(window.innerWidth / 50)) },
      () => new Mote(),
    );

    // Throttle to ~30 fps to save CPU/battery
    let lastFrame = 0;
    function animate(now) {
      if (now - lastFrame > 33) {
        ctx.clearRect(0, 0, width, height);
        motes.forEach((m) => {
          m.update();
          m.draw();
        });
        lastFrame = now;
      }
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  // --- Dropdown ---
  const dropdown = document.querySelector(".dropdown > a");
  if (dropdown) {
    dropdown.addEventListener("click", (e) => {
      e.preventDefault();
      const parent = dropdown.parentElement;
      parent.classList.toggle("dropdown-active");
    });
  }

  window.addEventListener("click", (e) => {
    const dropdowns = document.querySelectorAll(".dropdown");
    dropdowns.forEach((dropdown) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove("dropdown-active");
      }
    });
  });

  // --- Mobile Nav Hamburger ---
  const headerNav = document.querySelector(".hero-header nav");
  const navList = headerNav && headerNav.querySelector(":scope > ul");
  if (headerNav && navList) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle";
    toggle.setAttribute("aria-label", "Toggle navigation menu");
    toggle.setAttribute("aria-controls", "primary-nav");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "☰";
    navList.id = "primary-nav";
    headerNav.insertBefore(toggle, navList);

    const setOpen = (open) => {
      navList.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.innerHTML = open ? "✕" : "☰";
    };

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!navList.classList.contains("is-open"));
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (!headerNav.contains(e.target) && navList.classList.contains("is-open")) {
        setOpen(false);
      }
    });

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && navList.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Reset state when resizing past the mobile breakpoint
    const mq = window.matchMedia("(min-width: 641px)");
    mq.addEventListener("change", (ev) => {
      if (ev.matches) setOpen(false);
    });
  }

  // --- Wishlist (Daydream List) heart-injection on .grid-item ---
  // (data layer functions readWishlist/writeWishlist/etc. are hoisted to module scope)
  const HEART_SVG = `
    <svg class="heart-outline" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
    <svg class="heart-filled" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>`;

  // Inject heart toggles into product/collection grid items
  document.querySelectorAll(".grid-item").forEach((item) => {
    if (item.querySelector(".wishlist-toggle")) return;
    const nameEl = item.querySelector("h4");
    const imgEl = item.querySelector("img");
    const categoryEl = item.querySelector("p");
    if (!nameEl || !imgEl) return;

    const data = {
      name: nameEl.textContent.trim(),
      image: imgEl.getAttribute("src"),
      category: categoryEl ? categoryEl.textContent.trim() : "",
    };

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wishlist-toggle";
    btn.innerHTML = HEART_SVG;

    const setState = (favorited) => {
      btn.classList.toggle("is-favorited", favorited);
      btn.setAttribute("aria-pressed", String(favorited));
      btn.setAttribute(
        "aria-label",
        favorited
          ? `Remove ${data.name} from your daydream list`
          : `Add ${data.name} to your daydream list`,
      );
    };
    setState(inWishlist(data));

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const added = toggleWishlist(data);
      setState(added);
      if (added) {
        // Re-trigger pop animation if class was already there
        btn.style.animation = "none";
        forceReflow(btn);
        btn.style.animation = "";
      }
    });

    item.appendChild(btn);
  });

  // --- Snipcart bootstrap (sitewide if API key is configured) ---
  const snipcartKey = window.PNP_CONFIG?.snipcartApiKey || "";
  const snipcartVersion = window.PNP_CONFIG?.snipcartVersion || "3.7.1";
  if (snipcartKey && !document.getElementById("snipcart")) {
    // Preconnects + stylesheet
    const head = document.head;
    [
      ["link", { rel: "preconnect", href: "https://app.snipcart.com" }],
      ["link", { rel: "preconnect", href: "https://cdn.snipcart.com" }],
      [
        "link",
        {
          rel: "stylesheet",
          href: `https://cdn.snipcart.com/themes/v${snipcartVersion}/default/snipcart.css`,
        },
      ],
    ].forEach(([tag, attrs]) => {
      if (head.querySelector(`${tag}[href="${attrs.href}"]`)) return;
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      head.appendChild(el);
    });

    // Snipcart library
    if (!document.querySelector('script[src*="snipcart.com"]')) {
      const s = document.createElement("script");
      s.async = true;
      s.src = `https://cdn.snipcart.com/themes/v${snipcartVersion}/default/snipcart.js`;
      document.body.appendChild(s);
    }

    // Hidden bootstrap div (Snipcart reads its data attrs to init)
    const boot = document.createElement("div");
    boot.id = "snipcart";
    boot.hidden = true;
    boot.setAttribute("data-api-key", snipcartKey);
    document.body.appendChild(boot);
  }

  // Inject Adopt nav link (before Contact) on pages that don't already have one
  if (navList && !navList.querySelector('a[href="adopt.html"]')) {
    const adoptLi = document.createElement("li");
    adoptLi.innerHTML = '<a href="adopt.html">Adopt</a>';
    const contactLi = navList.querySelector('a[href="contact.html"]');
    if (contactLi && contactLi.parentElement) {
      navList.insertBefore(adoptLi, contactLi.parentElement);
    } else {
      const dropdownLi = navList.querySelector(".dropdown");
      if (dropdownLi) navList.insertBefore(adoptLi, dropdownLi);
      else navList.appendChild(adoptLi);
    }
  }

  // Inject Daydreams nav link with badge
  if (navList && !navList.querySelector(".nav-daydreams")) {
    const li = document.createElement("li");
    li.className = "nav-daydreams";
    li.innerHTML = `<a href="daydream-list.html" aria-label="View your daydream list"><span class="heart-mark" aria-hidden="true">♡</span><span class="count" aria-hidden="true">0</span></a>`;

    // Insert before the dropdown (About) so it sits among regular links
    const dropdownLi = navList.querySelector(".dropdown");
    if (dropdownLi) {
      navList.insertBefore(li, dropdownLi);
    } else {
      navList.appendChild(li);
    }

    const updateBadge = () => {
      const count = readWishlist().length;
      li.classList.toggle("has-items", count > 0);
      const countEl = li.querySelector(".count");
      if (countEl) countEl.textContent = String(count);
    };
    updateBadge();
    window.addEventListener("wishlist:change", updateBadge);
    window.addEventListener("storage", (e) => {
      if (e.key === WISHLIST_KEY) updateBadge();
    });
  }

  // Inject Cart nav link (only if Snipcart configured) — sits after Daydreams
  if (snipcartKey && navList && !navList.querySelector(".nav-cart")) {
    const cartLi = document.createElement("li");
    cartLi.className = "nav-cart";
    cartLi.innerHTML =
      '<a href="#" class="snipcart-checkout" aria-label="Open cart"><span class="cart-mark" aria-hidden="true">⌂</span><span class="snipcart-items-count count" aria-hidden="true">0</span></a>';
    const daydreamsLi = navList.querySelector(".nav-daydreams");
    if (daydreamsLi) {
      navList.insertBefore(cartLi, daydreamsLi.nextSibling);
    } else {
      const dropdownLi = navList.querySelector(".dropdown");
      if (dropdownLi) navList.insertBefore(cartLi, dropdownLi);
      else navList.appendChild(cartLi);
    }

    // Toggle .has-items so the badge only shows when count > 0
    document.addEventListener("snipcart.ready", () => {
      if (typeof window.Snipcart === "undefined") return;
      const update = () => {
        try {
          const count = window.Snipcart.store.getState().cart.items.count || 0;
          cartLi.classList.toggle("has-items", count > 0);
        } catch (storeErr) {
          // Snipcart not fully initialized yet — store may not be readable on
          // the first tick. Subscribe() will retry; logging the message helps
          // debug if it never recovers.
          if (window.console)
            window.console.warn("[snipcart] store read failed:", storeErr.message);
        }
      };
      update();
      window.Snipcart.store.subscribe(update);
    });
  }

  // --- Newsletter signup ---
  const newsletterEl = document.querySelector(".newsletter");
  if (newsletterEl) {
    const form = newsletterEl.querySelector("form");
    const emailInput = newsletterEl.querySelector('input[type="email"]');
    // Endpoint resolution order:
    //   1. data-newsletter-endpoint attribute on the element (page override)
    //   2. window.PNP_CONFIG.newsletterEndpoint (set by build-config.js)
    //   3. /api/subscribe (Vercel Function default)
    const endpoint =
      newsletterEl.getAttribute("data-newsletter-endpoint") ||
      window.PNP_CONFIG?.newsletterEndpoint ||
      "/api/subscribe";

    if (form && emailInput) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        if (!EMAIL_RE.test(email)) {
          newsletterEl.dataset.state = "error";
          emailInput.focus();
          return;
        }

        // Dev/preview mode: placeholder endpoint, no backend configured yet
        if (!endpoint || endpoint === "YOUR_NEWSLETTER_ENDPOINT") {
          newsletterEl.dataset.state = "success";
          return;
        }

        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          newsletterEl.dataset.state = "success";
        } catch (submitErr) {
          if (window.console) window.console.warn("[newsletter] submit failed:", submitErr);
          newsletterEl.dataset.state = "error";
        }
      });
    }
  }

  // --- Behind-the-Seams active step tracker ---
  const railDots = document.querySelectorAll(".story-rail .dot");
  const processSteps = document.querySelectorAll(".process-step");
  if (railDots.length > 0 && processSteps.length > 0) {
    const setActiveStep = (step) => {
      railDots.forEach((d) => {
        d.classList.toggle("active", d.dataset.step === String(step));
      });
    };

    // Track which step is in the "active band" (~middle of viewport)
    const stepObserver = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the middle of the viewport
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          const step = visible[0].target.dataset.step;
          if (step) setActiveStep(step);
        }
      },
      {
        // Active when section's middle crosses the upper-middle of viewport
        rootMargin: "-30% 0% -45% 0%",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    processSteps.forEach((s) => stepObserver.observe(s));
  }

  // --- Next Drop Countdown ---
  const dropEl = document.querySelector(".next-drop");
  if (dropEl) {
    const dropAt = dropEl.getAttribute("data-drop-at");
    const dropName = dropEl.getAttribute("data-drop-name") || "Next Drop";
    const dropMeta = dropEl.getAttribute("data-drop-meta") || "";
    const nameEl = dropEl.querySelector(".drop-name");
    const metaEl = dropEl.querySelector(".drop-meta");
    const numD = dropEl.querySelector("[data-d]");
    const numH = dropEl.querySelector("[data-h]");
    const numM = dropEl.querySelector("[data-m]");
    const numS = dropEl.querySelector("[data-s]");

    if (nameEl) nameEl.textContent = dropName;
    if (metaEl) metaEl.textContent = dropMeta;

    const target = dropAt ? new Date(dropAt).getTime() : NaN;
    const validTarget = Number.isFinite(target);

    const MS_PER_DAY = 86400000;
    const MS_PER_HOUR = 3600000;
    const MS_PER_MIN = 60000;
    const MS_PER_SEC = 1000;

    const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, "0");
    const setText = (el, text) => {
      if (el) el.textContent = text;
    };

    const renderIdle = () => {
      dropEl.dataset.state = "idle";
      setText(nameEl, "Next drop coming soon");
      setText(metaEl, "Date will be announced — keep an eye out!");
    };

    const renderLive = () => {
      dropEl.dataset.state = "live";
      setText(numD, "0");
      setText(numH, "00");
      setText(numM, "00");
      setText(numS, "00");
      setText(nameEl, `${dropName} — live now!`);
    };

    const renderCounting = (diff) => {
      dropEl.dataset.state = "counting";
      setText(numD, String(Math.floor(diff / MS_PER_DAY)));
      setText(numH, pad(Math.floor((diff % MS_PER_DAY) / MS_PER_HOUR)));
      setText(numM, pad(Math.floor((diff % MS_PER_HOUR) / MS_PER_MIN)));
      setText(numS, pad(Math.floor((diff % MS_PER_MIN) / MS_PER_SEC)));
    };

    const tick = () => {
      if (!validTarget) return renderIdle();
      const diff = target - Date.now();
      if (diff <= 0) return renderLive();
      return renderCounting(diff);
    };

    tick();
    if (validTarget) {
      const interval = setInterval(tick, 1000);
      // Clean up if user navigates away (defensive — DOMContentLoaded scope)
      window.addEventListener("beforeunload", () => clearInterval(interval));
    }
  }

  // Render daydream list page contents
  const daydreamMount = document.querySelector("[data-daydream-list]");
  if (daydreamMount) {
    const renderDaydreams = () => {
      const items = readWishlist();

      if (items.length === 0) {
        daydreamMount.innerHTML = `
          <div class="daydream-empty">
            <span class="big-icon" aria-hidden="true">♡</span>
            <h3>Your Daydream List is Empty</h3>
            <p>When you spot a plushie that catches your eye, tap the little heart to keep them here for later.</p>
            <a href="Collection.html" class="btn btn-solid">Browse the Collection</a>
          </div>`;
        return;
      }

      daydreamMount.innerHTML = `
        <div class="product-grid">
          ${items
            .map(
              (item) => `
            <div class="grid-item">
              <img src="${escapeHTML(item.image)}" loading="lazy" decoding="async" alt="${escapeHTML(item.name)}" />
              <h4>${escapeHTML(item.name)}</h4>
              <p>${escapeHTML(item.category)}</p>
              <button type="button" class="daydream-remove"
                data-name="${escapeHTML(item.name)}"
                data-image="${escapeHTML(item.image)}">Remove</button>
            </div>`,
            )
            .join("")}
        </div>`;

      daydreamMount.querySelectorAll(".daydream-remove").forEach(attachRemoveHandler);
    };

    const matchesItemRef = (i, name, image) => i.name === name && i.image === image;

    const removeFromList = (name, image) => {
      const list = readWishlist().filter((i) => !matchesItemRef(i, name, image));
      writeWishlist(list);
      renderDaydreams();
    };

    function attachRemoveHandler(btn) {
      btn.addEventListener("click", () => removeFromList(btn.dataset.name, btn.dataset.image));
    }

    renderDaydreams();
    window.addEventListener("wishlist:change", renderDaydreams);
    window.addEventListener("storage", (e) => {
      if (e.key === WISHLIST_KEY) renderDaydreams();
    });
  }
});
