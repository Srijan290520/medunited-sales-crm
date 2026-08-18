// Attachments.gs — stores bill/payment screenshots in Google Drive and
// returns a link to save in the sheet. Images arrive from the browser as
// base64 data URLs (e.g. "data:image/png;base64,AAAA...").
//
// Files are shared as "anyone with the link can view" so the app can show
// them without asking the viewer to sign in separately. If your MedUnited
// Google account is on Workspace and you'd rather restrict this to people in
// your organization, change DriveApp.Access.ANYONE_WITH_LINK below to
// DriveApp.Access.DOMAIN_WITH_LINK.

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
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}
