document.addEventListener("DOMContentLoaded", () => {
  // --- Carousel ---
  const carousel = document.querySelector(".carousel");
  if (carousel) {
    // --- Data and Setup ---
    const allPhotos = [
      "1.png",
      "10.png",
      "11.png",
      "12.png",
      "13.png",
      "14.png",
      "15.png",
      "16.png",
      "17.png",
      "18.png",
      "19.png",
      "2.png",
      "20.png",
      "21.png",
      "22.png",
      "23.png",
      "24.png",
      "25.png",
      "26.png",
      "27.png",
      "28.png",
      "29.png",
      "3.png",
      "30.png",
      "31.png",
      "32.png",
      "33.png",
      "34.png",
      "35.png",
      "36.png",
      "37.png",
      "38.png",
      "39.png",
      "4.png",
      "40.png",
      "41.png",
      "42.png",
      "43.png",
      "44.png",
      "45.png",
      "46.png",
      "47.png",
      "48.png",
      "49.png",
      "5.png",
      "50.png",
      "51.png",
      "52.png",
      "53.png",
      "54.png",
      "55.png",
      "56.png",
      "57.png",
      "58.png",
      "59.png",
      "6.png",
      "60.png",
      "61.png",
      "62.png",
      "63.png",
      "64.png",
      "65.png",
      "66.png",
      "67.png",
      "68.png",
      "69.png",
      "7.png",
      "70.png",
      "71.png",
      "72.png",
      "73.png",
      "74.png",
      "75.png",
      "76.png",
      "8.png",
      "9.png",
    ];

    // Shuffle and pick 15 random photos
    for (let i = allPhotos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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
      img.src = `Photos/${photo}`;
      img.alt = `Plushie ${photo.replace(".png", "")}`;
      img.draggable = false;
      const p = document.createElement("p");
      p.textContent = `Plushie #${photo.replace(".png", "")}`;

      inner.appendChild(img);
      inner.appendChild(p);
      item.appendChild(inner);

      inner.addEventListener("click", () => {
        if (!hasDragged && typeof window.openLightbox === "function") {
          window.openLightbox(`Photos/${photo}`);
        }
      });

      return item;
    };

    // Create clones for infinite loop
    photos.forEach((photo) =>
      carouselTrack.appendChild(createCarouselItem(photo)),
    );
    photos.forEach((photo) =>
      carouselTrack.appendChild(createCarouselItem(photo)),
    );
    photos.forEach((photo) =>
      carouselTrack.appendChild(createCarouselItem(photo)),
    );

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
        .carousel-track { display: flex; align-items: center; padding: 3rem 0; gap: 1.5rem; }
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
      scrollSpeed = 0.5;

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
          if (
            filterValue === "all" ||
            item.getAttribute("data-category") === filterValue
          ) {
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
      .map((word) => `<span class="fat-word">${word}</span>`)
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
    window.openLightbox = (imgSrc) => {
      lightboxImg.src = imgSrc;
      lightbox.classList.add("active");
    };

    const closeLightbox = () => {
      lightbox.classList.remove("active");
      setTimeout(() => {
        lightboxImg.src = "";
      }, 300);
    };

    lightboxClose.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) {
        closeLightbox();
      }
    });
  }

  // --- Background Confetti ---
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
    opacity: "0.7",
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

  class Confetti {
    constructor() {
      this.reset(true);
    }
    reset(initial = false) {
      this.x = Math.random() * width;
      this.y = initial
        ? Math.random() * height
        : window.scrollY - 100;
      this.angle = Math.random() * Math.PI * 2;
      this.speed = Math.random() * 2 + 1;
      this.rotation = Math.random() * Math.PI * 2;
      this.rotationSpeed = (Math.random() - 0.5) * 0.1;
      this.size = 5 + Math.random() * 5;
      this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
    }
    update() {
      this.y += this.speed;
      this.x += Math.sin(this.y / 20) * 0.5;
      this.rotation += this.rotationSpeed;

      if (this.y > window.scrollY + height + 100) {
        this.reset();
      }
    }
    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      ctx.fillStyle = this.color;
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
      ctx.restore();
    }
  }

  const confetti = Array.from({ length: 100 }, () => new Confetti());

  function animate() {
    ctx.clearRect(0, 0, width, height);
    confetti.forEach((c) => {
      c.update();
      c.draw();
    });
    requestAnimationFrame(animate);
  }
  animate();

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
});
