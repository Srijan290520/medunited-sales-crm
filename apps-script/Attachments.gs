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

  var bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    throw new Error('Image is too large (max 5MB). Please compress or crop the screenshot.');
  }

  var ext = mimeType.split('/')[1];
  var blob = Utilities.newBlob(bytes, mimeType, filenamePrefix + '.' + ext);
  var file = getAttachmentsFolder().createFile(blob);
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  return file.getUrl();
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
  return {
    name: file.getName(),
    dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes())
  };
}
