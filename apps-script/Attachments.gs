// Attachments.gs — stores bill/payment screenshots in Google Drive.
//
// Files are PRIVATE to the account the script runs as — they are never
// shared by link. The app shows a screenshot by asking the backend for it
// (action "getAttachment"), which checks the viewer's session and that they
// are allowed to see that sale before returning the image. So a copied or
// leaked Drive link is useless to anyone outside the sheet owner's account.
//
// Screenshots uploaded before this change were shared "anyone with the
// link". Run lockDownExistingAttachments() once from the Apps Script editor
// (see Setup.gs) to make those private too.

var ATTACHMENTS_FOLDER_NAME = 'MedUnited Sales CRM Attachments';
var ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
var ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

function getAttachmentsFolder() {
  var folders = DriveApp.getFoldersByName(ATTACHMENTS_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(ATTACHMENTS_FOLDER_NAME);
}

// dataUrl looks like "data:image/png;base64,AAAA..."; filenamePrefix should
// not include an extension (one is added based on the image's mime type).
function saveAttachmentFromDataUrl(dataUrl, filenamePrefix) {
  if (!dataUrl) return null;

  var match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid image data.');

  var mimeType = match[1];
  if (ALLOWED_IMAGE_TYPES.indexOf(mimeType) === -1) {
    throw new Error('Only image files (PNG, JPG, WEBP, GIF) are allowed for screenshots.');
  }

  if (match[2].length > Math.ceil(ATTACHMENT_MAX_BYTES * 4 / 3) + 8) {
    throw new Error('Image is too large (max 5MB). Please compress or crop the screenshot.');
  }
  var bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    throw new Error('Image is too large (max 5MB). Please compress or crop the screenshot.');
  }
  // Check the file really is the image type it claims to be, so nothing
  // else (HTML, scripts, documents) can be smuggled into Drive.
  if (!looksLikeImage(bytes, mimeType)) throw new Error('That file is not a valid image.');

  var ext = mimeType === 'image/jpg' ? 'jpeg' : mimeType.split('/')[1];
  var blob = Utilities.newBlob(bytes, mimeType, filenamePrefix + '.' + ext);
  var file = getAttachmentsFolder().createFile(blob);
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  return file.getUrl();
}

function looksLikeImage(bytes, mimeType) {
  function b(i) { return bytes[i] & 0xFF; }
  if (bytes.length < 12) return false;
  if (mimeType === 'image/png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47;
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF;
  if (mimeType === 'image/gif') return b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46;
  if (mimeType === 'image/webp') return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  return false;
}

// Pulls the Drive file ID out of the URL stored in the sheet
// (https://drive.google.com/file/d/<id>/view... or ...?id=<id>).
function driveFileIdFromUrl(url) {
  var m = /\/d\/([a-zA-Z0-9_-]+)/.exec(String(url)) || /[?&]id=([a-zA-Z0-9_-]+)/.exec(String(url));
  return m ? m[1] : null;
}

// Returns the image as a data URL. Caller must already have checked that
// the viewer is allowed to see the sale this file belongs to.
function readAttachmentAsDataUrl(url) {
  var fileId = driveFileIdFromUrl(url);
  if (!fileId) throw new Error('Attachment link is not a Drive file.');

  var file = DriveApp.getFileById(fileId);
  var parents = file.getParents();
  var inFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getName() === ATTACHMENTS_FOLDER_NAME) { inFolder = true; break; }
  }
  if (!inFolder) throw new Error('Attachment is not in the CRM attachments folder.');

  var blob = file.getBlob();
  if (ALLOWED_IMAGE_TYPES.indexOf(blob.getContentType()) === -1) throw new Error('Attachment is not an image.');
  return {
    name: file.getName(),
    dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes())
  };
}
