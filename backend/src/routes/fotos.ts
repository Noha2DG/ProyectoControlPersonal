import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth, requireAdmin } from "../middleware/auth.ts";

const router = Router();

// Anclado a este archivo (backend/src/routes) y no al cwd — ver RAIZ_BACKEND en index.ts.
const FOTOS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads", "fotos");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FOTOS_DIR),
  filename: (req, _file, cb) => cb(null, `${req.params.codigo}.jpg`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Solo se permiten imágenes"));
  },
});

// POST /api/fotos/:codigo  (admin only)
router.post("/:codigo", requireAuth, requireAdmin, upload.single("foto"), (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
