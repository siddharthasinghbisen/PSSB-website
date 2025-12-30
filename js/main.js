// Tab switching with video control
function setActiveTab(tabName, btnElement) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.service-demo').forEach(d => d.classList.remove('active'));

  if (btnElement) btnElement.classList.add('active');
  const activeDemo = document.getElementById('demo-' + tabName);
  if (activeDemo) activeDemo.classList.add('active');

  // Pause all videos, then play the active one
  document.querySelectorAll('.demo-video-container video').forEach(v => {
    try { v.pause(); v.currentTime = 0; } catch(e) {}
  });
  const activeVideo = activeDemo ? activeDemo.querySelector('video') : null;
  if (activeVideo) {
    try { activeVideo.play(); } catch(e) {}
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tabName = e.currentTarget.getAttribute('data-tab');
    setActiveTab(tabName, e.currentTarget);
  });
});

// Initialize: ensure first tab video plays
document.addEventListener('DOMContentLoaded', () => {
  const first = document.querySelector('.tab-btn.active');
  if (first) setActiveTab(first.getAttribute('data-tab'), first);
});

// Intersection Observer for fade-in animations
const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -100px 0px' };
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.animation = 'fadeInUp 0.8s ease-out forwards';
    }
  });
}, observerOptions);
document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ================================
   Polygon Segmentation Annotation Game
   - Click to place points
   - Double-click or Enter to close polygon
   - Press 'd' to delete last point
   - Particle effects on click
   - Timeout if drawing too slowly
   ================================ */
const canvas = document.getElementById('annot-canvas');
if (canvas) {
  const ctx = canvas.getContext('2d');
  const img = document.getElementById('annot-img');
  
  let gtData = null;
  let currentPoints = []; // user's current drawing
  let isDrawing = false;
  let lastClickTime = 0;
  let lastClickTimeForTimeout = 0;
  let timeoutTimer = null; // timer for 5-second inactivity
  let hasAttempted = false; // track if user has started drawing
  let firstClickTime = null; // time of first point placement
  let IOU_THRESHOLD = 0.8;
  canvas._zoom = 1;
  const DOUBLE_CLICK_DELAY = 300;
  const DRAW_TIMEOUT = 7000; // 7 seconds after first click

  // Scale canvas to match image dimensions with proper positioning
  function resizeCanvas() {
    if (img && img.complete && img.naturalWidth > 0) {
      // Fit the image uniformly inside the hero and center it.
      const heroSection = document.querySelector('.hero');
      if (!heroSection) return;

      const heroRect = heroSection.getBoundingClientRect();
      const heroWidth = heroRect.width;
      const heroHeight = heroRect.height;

      const imgWidth = img.naturalWidth;
      const imgHeight = img.naturalHeight;

      // Uniform scale so image always fits inside hero (no overflow below hero)
      const scale = Math.min(heroWidth / imgWidth, heroHeight / imgHeight, 1);
      const displayWidth = Math.round(imgWidth * scale);
      const displayHeight = Math.round(imgHeight * scale);
      const offsetX = Math.round((heroWidth - displayWidth) / 2);
      const offsetY = Math.round((heroHeight - displayHeight) / 2);

      // Canvas internal resolution matches image natural size for accurate drawing
      canvas.width = imgWidth;
      canvas.height = imgHeight;

      // Position and size both the image and canvas to the computed display size
      canvas.style.position = 'absolute';
      canvas.style.left = offsetX + 'px';
      canvas.style.top = offsetY + 'px';
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';

      img.style.position = 'absolute';
      img.style.left = offsetX + 'px';
      img.style.top = offsetY + 'px';
      img.style.width = displayWidth + 'px';
      img.style.height = displayHeight + 'px';

      // Store scale factors for conversions between GT (natural pixels) and display
      canvas._scaleX = displayWidth / imgWidth;
      canvas._scaleY = displayHeight / imgHeight;
      canvas._offsetX = offsetX;
      canvas._offsetY = offsetY;
      
      drawCanvas();
    } else {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
  }

  // Wait for image to load, then resize
  if (img.complete) {
    resizeCanvas();
  } else {
    img.addEventListener('load', resizeCanvas);
  }
  window.addEventListener('resize', resizeCanvas);

  // Load GT data from JSON
  async function loadGTData() {
    try {
      const url = window.GT_DATA_URL || 'assets/ground_truth_polygons.json';
      const res = await fetch(url);
      gtData = await res.json();
      console.log('GT data loaded:', gtData);
      drawCanvas();
    } catch (err) {
      console.error('Failed to load GT data:', err);
    }
  }

  // Polygon IoU calculation
  function polygonArea(points) {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const x1 = points[i][0], y1 = points[i][1];
      const x2 = points[(i + 1) % points.length][0], y2 = points[(i + 1) % points.length][1];
      area += (x1 * y2 - x2 * y1);
    }
    return Math.abs(area) / 2;
  }

  // Simple polygon-polygon IoU using bounding box approximation
  function polygonIOU(poly1, poly2) {
    const area1 = polygonArea(poly1);
    const area2 = polygonArea(poly2);
    if (area1 === 0 || area2 === 0) return 0;

    const getBox = (poly) => {
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      return {
        x1: Math.min(...xs), y1: Math.min(...ys),
        x2: Math.max(...xs), y2: Math.max(...ys)
      };
    };

    const box1 = getBox(poly1), box2 = getBox(poly2);
    const xA = Math.max(box1.x1, box2.x1);
    const yA = Math.max(box1.y1, box2.y1);
    const xB = Math.min(box1.x2, box2.x2);
    const yB = Math.min(box1.y2, box2.y2);
    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const unionArea = area1 + area2 - interArea;

    return unionArea > 0 ? interArea / unionArea : 0;
  }

  function drawGT() {
    if (!gtData || !gtData.objects) return;
    ctx.save();
    // compute current scale factors (GT coords -> canvas pixels)
    const sx = canvas._scaleX || 1;
    const sy = canvas._scaleY || 1;
    gtData.objects.forEach((obj) => {
      // Support two GT formats: obj.points = [[x,y],...] or obj.segmentation = [[x1,y1,x2,y2,...]]
      let points = null;
      if (obj.points && obj.points.length) {
        points = obj.points;
      } else if (obj.segmentation && obj.segmentation.length) {
        // segmentation may be one of:
        // 1) flattened array: [x1,y1,x2,y2,...]
        // 2) wrapped flattened: [[x1,y1,x2,y2,...]] (COCO common format)
        // 3) array of [x,y] pairs: [[x1,y1],[x2,y2],...]
        const segRoot = obj.segmentation;
        // Case 1: all numbers
        if (segRoot.every(el => typeof el === 'number')) {
          points = [];
          for (let i = 0; i < segRoot.length; i += 2) points.push([segRoot[i], segRoot[i+1]]);
        } else if (Array.isArray(segRoot[0]) && segRoot.length === 1 && segRoot[0].every(n => typeof n === 'number')) {
          // wrapped flattened inside first element
          const flat = segRoot[0];
          points = [];
          for (let i = 0; i < flat.length; i += 2) points.push([flat[i], flat[i+1]]);
        } else if (Array.isArray(segRoot[0]) && Array.isArray(segRoot[0][0])) {
          // sometimes segmentation is [[ [x,y], [x,y], ... ]] (double-nested)
          points = segRoot[0].map(p => [p[0], p[1]]);
        } else if (Array.isArray(segRoot[0]) && typeof segRoot[0][0] === 'number') {
          // segmentation is array of [x,y] pairs
          points = segRoot.map(p => [p[0], p[1]]);
        } else {
          // fallback: try to flatten everything
          const flat = segRoot.flat(2);
          points = [];
          for (let i = 0; i < flat.length; i += 2) points.push([flat[i], flat[i+1]]);
        }
      }
      if (points && points.length > 0) {
        ctx.strokeStyle = 'rgba(255,122,37,1)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        // draw scaled points
        ctx.moveTo(points[0][0] * sx, points[0][1] * sy);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i][0] * sx, points[i][1] * sy);
        }
        ctx.closePath();
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function drawCurrentPolygon(alpha = 1) {
    if (currentPoints.length === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(255,122,37,0.95)';
    ctx.lineWidth = 1.2; // user polygon slightly thinner than GT
    ctx.setLineDash([]);
    ctx.beginPath();
    // draw using scale factors
    const sx = canvas._scaleX || 1;
    const sy = canvas._scaleY || 1;
    ctx.moveTo(currentPoints[0][0] * sx, currentPoints[0][1] * sy);
    for (let i = 1; i < currentPoints.length; i++) {
      ctx.lineTo(currentPoints[i][0] * sx, currentPoints[i][1] * sy);
    }
    // close if enough points
    if (currentPoints.length > 2) {
      ctx.lineTo(currentPoints[0][0] * sx, currentPoints[0][1] * sy);
    }
    ctx.stroke();

    // Draw points as small dots (scaled)
    ctx.fillStyle = `rgba(255,122,37,${0.95 * alpha})`;
    currentPoints.forEach(p => {
      ctx.beginPath();
      ctx.arc(p[0] * sx, p[1] * sy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawCanvas(alpha = 1) {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGT();
    drawCurrentPolygon(alpha);
  }

  // Create particle burst effect
  function createParticleBurst(x, y) {
    const particleCount = 8;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const distance = 30 + Math.random() * 20;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;

      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = x + 'px';
      particle.style.top = y + 'px';
      particle.style.setProperty('--tx', tx + 'px');
      particle.style.setProperty('--ty', ty + 'px');
      particle.style.animation = 'particle-burst 0.6s ease-out forwards';
      
      const heroSection = document.querySelector('.hero');
      if (heroSection) {
        heroSection.appendChild(particle);
        setTimeout(() => particle.remove(), 600);
      }
    }
  }

  function showResultModal(iouScore, opts = {}) {
    const modal = document.getElementById('result-modal');
    const resultText = document.getElementById('result-text');
    if (!modal || !resultText) return;
    const timedOut = !!opts.timedOut;

    // Remove prior flash class
    resultText.classList.remove('flash');

    if (timedOut) {
      if (typeof iouScore === 'number' && iouScore > 0) {
        const pct = Math.round(iouScore * 100);
        resultText.innerHTML = `<strong>Time's up — IoU: ${pct}%</strong><br><em>You were close. Try again — our annotators complete it in less than 7 seconds.</em>`;
      } else {
        resultText.innerHTML = `<strong>Time's up!</strong><br><em>Try again — our annotators complete it in less than 7 seconds.</em>`;
      }
    } else {
      if (typeof iouScore === 'number' && iouScore >= 0) {
        const pct = Math.round(iouScore * 100);
        if (iouScore >= 0.9999) {
          resultText.innerHTML = `<strong>Perfect — IoU: ${pct}%</strong><br><em>Excellent — fully matched the GT polygon.</em>`;
        } else {
          resultText.innerHTML = `<strong>IoU Score: ${pct}%</strong><br><em>Good try — our annotators achieve 100% accuracy.</em>`;
          // trigger flash for non-perfect results
          setTimeout(() => resultText.classList.add('flash'), 40);
        }
      } else {
        resultText.innerHTML = `<strong>Time's up!</strong><br><em>Try again — our annotators complete it in less than 7 seconds.</em>`;
      }
    }

    modal.classList.add('show');
  }

  function hideResultModal() {
    const modal = document.getElementById('result-modal');
    if (modal) modal.classList.remove('show');
  }

  function showTimeout() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    // If user has drawn something, compute IoU against GT to decide message
    let maxIOU = 0;
    if (currentPoints && currentPoints.length > 2 && gtData && gtData.objects) {
      gtData.objects.forEach(obj => {
        let objPoints = null;
        if (obj.points && obj.points.length) objPoints = obj.points;
        else if (obj.segmentation && obj.segmentation.length && obj.segmentation[0].length) {
          const seg = obj.segmentation[0]; objPoints = [];
          for (let i = 0; i < seg.length; i += 2) objPoints.push([seg[i], seg[i+1]]);
        }
        if (objPoints) {
          const iou = polygonIOU(currentPoints, objPoints);
          maxIOU = Math.max(maxIOU, iou);
        }
      });
    }
    // Show modal with timedOut flag; if no overlap (maxIOU==0) user gets time-up message
    showResultModal(maxIOU > 0 ? maxIOU : null, { timedOut: true });

    // Reset drawing state and close the annotation view, but keep modal visible
    hasAttempted = false;
    firstClickTime = null;
    currentPoints = [];
    // Hide annotation UI elements (but do not hide modal)
    hero.classList.remove('annotation-active');
    if (closeBtn) closeBtn.style.display = 'none';
    const annotImg = document.getElementById('annot-img');
    if (annotImg) { annotImg.style.display = 'none'; annotImg.style.transform = ''; }
    if (canvas) { canvas.style.display = 'none'; canvas.style.zIndex = 10; canvas.style.transform = ''; canvas._zoom = 1; }
    window.GT_DATA_URL = 'assets/animal_segmentation_gt.json';
    gtData = null;
    drawCanvas();
    // restart slider to return to hero state behind the modal
    if (typeof startSlider === 'function') startSlider();
  }

  function closePolygon() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (currentPoints.length < 3) {
      const el = document.getElementById('score');
      if (el) el.textContent = 'Need 3+ points';
      return;
    }

    // Calculate IoU with closest GT polygon
    let maxIOU = 0;
    if (gtData && gtData.objects) {
      gtData.objects.forEach(obj => {
        let objPoints = null;
        if (obj.points && obj.points.length) objPoints = obj.points;
        else if (obj.segmentation && obj.segmentation.length && obj.segmentation[0].length) {
          const seg = obj.segmentation[0]; objPoints = [];
          for (let i = 0; i < seg.length; i += 2) objPoints.push([seg[i], seg[i+1]]);
        }
        if (objPoints) {
          const iou = polygonIOU(currentPoints, objPoints);
          maxIOU = Math.max(maxIOU, iou);
        }
      });
    }

    showResultModal(maxIOU);
    currentPoints = [];
    drawCanvas();
  }

  function clearDrawing() {
    currentPoints = [];
    const el = document.getElementById('score');
    if (el) el.textContent = '';
    drawCanvas();
  }

  // Canvas click: add point
  canvas.addEventListener('click', (e) => {
    // Only allow 1 attempt
    if (hasAttempted && currentPoints.length === 0) return;
    
    // Get canvas-relative coordinates with proper scaling
    const canvasRect = canvas.getBoundingClientRect();
    const clickX = e.clientX - canvasRect.left;
    const clickY = e.clientY - canvasRect.top;
    
    // Convert to GT image coordinates using scale factors (canvas pixels -> GT coords)
    const sx = canvas._scaleX || 1;
    const sy = canvas._scaleY || 1;
    const x = clickX / sx;
    const y = clickY / sy;

    const now = Date.now();
    
    // Track first click
    if (currentPoints.length === 0) {
      firstClickTime = now;
      hasAttempted = true;
      // Set 5-second timeout from first click
      if (timeoutTimer) clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        if (currentPoints.length > 0) showTimeout();
      }, DRAW_TIMEOUT);
    }

    if (now - lastClickTime < DOUBLE_CLICK_DELAY && currentPoints.length > 2) {
      // Double-click: close polygon
      closePolygon();
    } else {
      // Add point
      currentPoints.push([x, y]);
      createParticleBurst(e.clientX, e.clientY); // particle at screen coords
      drawCanvas();
    }
    lastClickTime = now;
  });

  // Keyboard: 'd' to delete last, Enter to close
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd' && currentPoints.length > 0) {
      currentPoints.pop();
      drawCanvas();
    }
    if (e.key === 'Enter' && currentPoints.length > 2) {
      closePolygon();
    }
  });

  // Wheel zoom (Ctrl + scroll) on canvas/image
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    const minZ = 1, maxZ = 3;
    let z = canvas._zoom || 1;
    z = Math.min(maxZ, Math.max(minZ, +(z + delta).toFixed(2)));
    canvas._zoom = z;
    // apply visual transform to both image and canvas while preserving centering translate
    if (img) img.style.transform = `translate(-50%, -50%) scale(${z})`;
    canvas.style.transform = `translate(-50%, -50%) scale(${z})`;
  }, { passive: false });

  // Load GT on load
  loadGTData();

  // Simple hero slider (autoplay)
  const slides = Array.from(document.querySelectorAll('.slide'));
let slideIndex = 0;
let slideTimer = null;
let resumeTimer = null;

function showSlide(i) {
  slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
}

function startSlider(delay = 5000) {
  stopSlider();

  slideTimer = setTimeout(() => {
    slideIndex = (slideIndex + 1) % slides.length;
    showSlide(slideIndex);
    startSlider(5000);
  }, delay);
}

function stopSlider() {
  if (slideTimer) {
    clearTimeout(slideTimer);
    slideTimer = null;
  }
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

startSlider(1800); // fast first transition

  // Pause autoplay on hover
const heroEl = document.querySelector('.hero');
if (heroEl) {
heroEl.addEventListener('mouseenter', stopSlider);
heroEl.addEventListener('mouseleave', () => startSlider());

}


  // Hero slider arrows
const prevArrow = document.querySelector('.hero-arrow.prev');
const nextArrow = document.querySelector('.hero-arrow.next');

function resumeAutoplayLater() {
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => startSlider(), 5500);
}

if (prevArrow && nextArrow) {
  prevArrow.addEventListener('click', () => {
    stopSlider();
    slideIndex = (slideIndex - 1 + slides.length) % slides.length;
    showSlide(slideIndex);
    resumeAutoplayLater();
  });

  nextArrow.addEventListener('click', () => {
    stopSlider();
    slideIndex = (slideIndex + 1) % slides.length;
    showSlide(slideIndex);
    resumeAutoplayLater();
  });
}



  // Annotation mode controls
  const hero = document.querySelector('.hero');
  const startBtn = document.getElementById('start-annot');
  const closeBtn = document.getElementById('close-annot');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      // Reset for new attempt
      hasAttempted = false;
      firstClickTime = null;
      currentPoints = [];
      if (timeoutTimer) clearTimeout(timeoutTimer);
      hideResultModal();
      
      stopSlider();
      hero.classList.add('annotation-active');
      if (closeBtn) closeBtn.style.display = 'block';
      // Set GT to street segmentation and show annot image
      window.GT_DATA_URL = 'assets/animal_segmentation_gt.json';
      const annotImg = document.getElementById('annot-img');
      if (annotImg) {
        // show image at its natural size without repositioning so GT coordinates map 1:1
        annotImg.style.display = 'block';
        annotImg.style.position = 'absolute';
        annotImg.style.left = '0px';
        annotImg.style.top = '0px';
        // Show image and let resizeCanvas compute display size and scale factors
        canvas.style.transform = 'none';
        canvas.style.display = 'block';
        canvas.style.zIndex = 60;

        if (annotImg.complete) {
          // resizeCanvas will set canvas.width/height and canvas._scaleX/_scaleY
          resizeCanvas();
          loadGTData();
          drawCanvas();
        } else {
          annotImg.onload = () => { resizeCanvas(); loadGTData(); drawCanvas(); };
        }
      } else {
        loadGTData();
      }
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      // Reset state
      hasAttempted = false;
      firstClickTime = null;
      currentPoints = [];
      if (timeoutTimer) clearTimeout(timeoutTimer);
      hideResultModal();
      
      hero.classList.remove('annotation-active');
      closeBtn.style.display = 'none';
      // Hide annotation image and clear GT overlay
      const annotImg = document.getElementById('annot-img');
      if (annotImg) { annotImg.style.display = 'none'; annotImg.style.transform = ''; }
      if (canvas) { canvas.style.display = 'none'; canvas.style.zIndex = 10; canvas.style.transform = ''; canvas._zoom = 1; }
      window.GT_DATA_URL = 'assets/animal_segmentation_gt.json';
      gtData = null; drawCanvas();
      startSlider();
    });
  }

  // Result modal OK button
  const resultOkBtn = document.getElementById('result-ok-btn');
  if (resultOkBtn) {
    resultOkBtn.addEventListener('click', () => {
      hideResultModal();
      // Reset to hero section
      const closeBtn = document.getElementById('close-annot');
      if (closeBtn) closeBtn.click();
    });
  }
}

// If profile image missing, use a generated SVG fallback
document.addEventListener('DOMContentLoaded', () => {
  const img = document.querySelector('.team img');
  if (!img) return;
  img.addEventListener('error', () => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><rect width='100%' height='100%' fill='%23ffffff'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI, Arial' font-size='48' fill='%230b1a2b'>PSSB</text></svg>`;
    img.src = 'data:image/svg+xml;base64,' + btoa(svg);
  });
});

  // Logo click: ensure scroll to top (smooth)
  document.addEventListener('DOMContentLoaded', () => {
    const brandLink = document.querySelector('.brand a');
    if (brandLink) {
      brandLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Read more toggles for partner cards (delegated)
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.read-more');
      if (!btn) return;
      const card = btn.closest('.partner-card');
      if (!card) return;
      const full = card.querySelector('.partner-full');
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        // hide
        full.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = 'Read more';
        full.setAttribute('aria-hidden', 'true');
      } else {
        // show
        full.style.display = 'block';
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Hide';
        full.setAttribute('aria-hidden', 'false');
      }
    });
  });

  // Partners slider and profile modal
  document.addEventListener('DOMContentLoaded', () => {
    const slides = Array.from(document.querySelectorAll('.partner-slide'));
    const prev = document.querySelector('.ps-btn.prev');
    const next = document.querySelector('.ps-btn.next');
    const dotsWrap = document.querySelector('.ps-dots');
    let idx = 0;

    if (!slides.length) return;

    // build dots
    slides.forEach((s, i) => {
      const dot = document.createElement('button');
      dot.className = 'ps-dot';
      dot.setAttribute('aria-label', `Go to partner ${i+1}`);
      dot.addEventListener('click', () => show(i));
      dotsWrap.appendChild(dot);
    });

    const dots = Array.from(dotsWrap.querySelectorAll('.ps-dot'));

    function show(i) {
      idx = (i + slides.length) % slides.length;
      slides.forEach((s, j) => s.classList.toggle('active', j === idx));
      dots.forEach((d, j) => d.classList.toggle('active', j === idx));
    }

    if (prev) prev.addEventListener('click', () => show(idx - 1));
    if (next) next.addEventListener('click', () => show(idx + 1));
    // init
    show(0);

    // View profile -> open modal with full bio
    const profileModal = createProfileModal();
    document.body.appendChild(profileModal.el);

    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-profile');
      if (!btn) return;
      const slide = btn.closest('.partner-slide');
      if (!slide) return;
      const img = slide.querySelector('.partner-left img');
      const name = slide.querySelector('h3') ? slide.querySelector('h3').textContent : '';
      const title = slide.querySelector('.partner-title') ? slide.querySelector('.partner-title').textContent : '';
      const full = slide.querySelector('.partner-full') ? slide.querySelector('.partner-full').innerHTML : '';
      profileModal.show({ img: img ? img.src : '', name, title, body: full });
    });

    function createProfileModal() {
      const el = document.createElement('div');
      el.id = 'profile-modal';
      el.className = 'profile-modal';
      el.innerHTML = `
        <div class="profile-modal-content">
          <button class="modal-close" aria-label="Close">×</button>
          <img id="profile-modal-img" src="" alt="">
          <div class="modal-body">
            <h3 id="profile-modal-name"></h3>
            <p id="profile-modal-title" class="partner-title"></p>
            <div id="profile-modal-body"></div>
            <div style="margin-top:14px"><button id="profile-close-btn" class="result-ok-btn">Close</button></div>
          </div>
        </div>`;

      const imgEl = el.querySelector('#profile-modal-img');
      const nameEl = el.querySelector('#profile-modal-name');
      const titleEl = el.querySelector('#profile-modal-title');
      const bodyEl = el.querySelector('#profile-modal-body');
      const closeBtn = el.querySelector('.modal-close');
      const okBtn = el.querySelector('#profile-close-btn');

      function show(opts) {
        imgEl.src = opts.img || '';
        imgEl.alt = opts.name || '';
        nameEl.textContent = opts.name || '';
        titleEl.textContent = opts.title || '';
        bodyEl.innerHTML = opts.body || '';
        el.classList.add('show');
      }
      function hide() { el.classList.remove('show'); }
      closeBtn.addEventListener('click', hide);
      okBtn.addEventListener('click', hide);
      el.addEventListener('click', (e) => { if (e.target === el) hide(); });

      return { el, show, hide };
    }
  });

if (prevArrow && nextArrow) {
  prevArrow.addEventListener('click', () => {
    stopSlider();
    slideIndex = (slideIndex - 1 + slides.length) % slides.length;
    showSlide(slideIndex);
    startSlider();
  });

  nextArrow.addEventListener('click', () => {
    stopSlider();
    slideIndex = (slideIndex + 1) % slides.length;
    showSlide(slideIndex);
    startSlider();
  });
}
