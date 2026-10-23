const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.mimetype)),
});

module.exports = upload;
