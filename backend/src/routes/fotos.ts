import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth, requireAdmin } from "../middleware/auth.ts";

const router = Router();

const FOTOS_DIR = path.join(process.cwd(), "uploads", "fotos");

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

// DELETE /api/fotos/:codigo  (admin only)
router.delete("/:codigo", requireAuth, requireAdmin, (req: Request, res: Response) => {
  const filePath = path.join(FOTOS_DIR, `${req.params.codigo}.jpg`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

export default router;
