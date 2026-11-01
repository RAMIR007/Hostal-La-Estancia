import { getSupabaseClient, isSupabaseConfigured } from "./supabase-client.js";

const menuButton = document.querySelector(".nav-toggle");
const navigation = document.querySelector("#site-nav");

if (menuButton instanceof HTMLButtonElement && navigation instanceof HTMLElement) {
  const closeMenu = () => {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Abrir menú");
    navigation.classList.remove("is-open");
  };

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    menuButton.setAttribute("aria-label", isOpen ? "Abrir menú" : "Cerrar menú");
    navigation.classList.toggle("is-open", !isOpen);
  });

  navigation.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menuButton.focus();
    }
  });
}

async function loadSiteContent() {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase.from("site_content").select("*").eq("id", true).single();
    if (error) {
      throw error;
    }

    document.querySelectorAll("[data-content]").forEach((element) => {
      const field = element.dataset.content;
      if (field && typeof data[field] === "string") {
        element.textContent = data[field];
      }
    });

    document.querySelectorAll("[data-site-image]").forEach((image) => {
      const field = image.dataset.siteImage;
      const url = field && data[field];
      if (typeof url !== "string" || !url) {
        image.hidden = true;
        return;
      }

      image.addEventListener("load", () => {
        image.hidden = false;
        if (field === "hero_image_url") {
          image.closest(".hero-art")?.classList.add("has-photo");
          image.closest(".hero-art")?.setAttribute("aria-label", "Fotografía de Hostal La Estancia en La Habana");
        } else {
          image.closest("[data-gallery-item]")?.removeAttribute("hidden");
          document.querySelector("#fotos")?.removeAttribute("hidden");
        }
      }, { once: true });
      image.addEventListener("error", () => {
        image.hidden = true;
      }, { once: true });
      image.src = url;
    });
    document.querySelectorAll("[data-gallery-item]").forEach((item) => {
      const image = item.querySelector("img");
      if (!image?.getAttribute("src")) {
        item.hidden = true;
      }
    });

    renderContactLinks(data);
  } catch (error) {
    console.error("No se pudo cargar el contenido del sitio desde Supabase.", error);
    const status = document.querySelector("[data-site-status]");
    if (status) {
      status.textContent = "Algunos datos del sitio no se pudieron actualizar. Vuelve a intentarlo más tarde.";
      status.hidden = false;
    }
  }
}

function renderContactLinks(data) {
  const links = document.querySelector("[data-contact-links]");
  const placeholder = document.querySelector("[data-contact-placeholder]");
  if (!links || !placeholder) {
    return;
  }

  const items = [];
  if (typeof data.whatsapp === "string" && data.whatsapp.trim()) {
    const phone = data.whatsapp.replace(/\D/g, "");
    if (phone.length >= 7 && phone.length <= 15) {
      items.push({
        label: "Escríbenos por WhatsApp",
        href: `https://wa.me/${phone}`,
      });
    }
  }
  if (typeof data.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    items.push({
      label: "Envíanos un correo",
      href: `mailto:${data.email.trim()}`,
    });
  }

  if (!items.length) {
    return;
  }

  links.replaceChildren();
  for (const item of items) {
    const link = document.createElement("a");
    link.className = "button button--light";
    link.href = item.href;
    link.textContent = item.label;
    links.append(link);
  }
  links.hidden = false;
  placeholder.hidden = true;
}

loadSiteContent();
