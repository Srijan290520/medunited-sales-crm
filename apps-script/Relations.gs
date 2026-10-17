// Relations.gs — family links between patients (father, wife, caregiver…),
// for people who don't share a phone number (those are already a household).
//
//   addPatientRelation     link two patients, each side with its own word:
//                          "Ramesh is Sunita's Father" and "Sunita is
//                          Ramesh's Daughter" (no gender on file, so the
//                          person linking confirms the reverse)
//   removePatientRelation  unlink, with an optional reason
//
// A link is only information: each patient keeps their own agent, and a
// relative's records keep their own rules. Anyone who can see a profile sees
// the relatives' names and relations (everyone can look up any patient).
// Linking or unlinking needs the agent of either patient, a manager or an
// admin; every change is audited.
//
// PatientRelations: ID | PatientID | RelatedID | Relation | ReverseRelation |
//   CreatedAt | CreatedBy | CreatedByName | RemovedAt | RemovedBy | RemovedReason
// Relation = what RelatedID is to PatientID; ReverseRelation = what PatientID
// is to RelatedID. Unlinking stamps RemovedAt; rows are never deleted.

var RELATION_HEADERS = ['ID', 'PatientID', 'RelatedID', 'Relation', 'ReverseRelation',
  'CreatedAt', 'CreatedBy', 'CreatedByName', 'RemovedAt', 'RemovedBy', 'RemovedReason'];

function getRelationsSheet() { return getOrCreateSheet('PatientRelations', RELATION_HEADERS); }

function activeRelations() {
  return sheetToObjects(getRelationsSheet()).filter(function (r) { return r.ID && !r.RemovedAt; });
}

// One patient's relatives: what each is to this patient.
function relationsFor(world, patientId) {
  var id = String(patientId);
  var out = [];
  activeRelations().forEach(function (r) {
    var other, word;
    if (String(r.PatientID) === id) { other = r.RelatedID; word = r.Relation; }
    else if (String(r.RelatedID) === id) { other = r.PatientID; word = r.ReverseRelation; }
    else return;
    var q = world.byId[String(other)];
    if (!q) return; // a patient no longer on file: hide the link, keep the row
    var o = ownerOfPatient(world, q);
    out.push({
      ID: String(r.ID), Relation: String(word || ''), PatientID: String(q.ID), Name: String(q.Name),
      Contact: String(q.Contact || ''), OwnerName: o ? o.name : '', Conflict: q.OwnerStatus === PATIENT_CONFLICT
    });
  });
  out.sort(function (a, b) { return a.Relation < b.Relation ? -1 : a.Relation > b.Relation ? 1 : a.Name < b.Name ? -1 : 1; });
  return out;
}

function cleanRelationWord(v, allowed) {
  var w = cleanText(v, 50);
  var hit = allowed.filter(function (x) { return x.toLowerCase() === w.toLowerCase(); })[0];
  if (!hit) throw new Error('Choose a relation from the list.');
  return hit;
}

function requireRelationEditor(session, world, a, b) {
  if (canEditPatient(session, world, a) || canEditPatient(session, world, b)) return;
  throw new ForbiddenError('Only the agent of one of these patients, a manager or an admin can link or unlink them.');
}

// data: { patientId, relatedId, relation, reverseRelation }
function svc_addPatientRelation(session, data) {
  data = data || {};
  var world = loadPatientWorld();
  var a = requirePatient(world, data.patientId);
  var b = requirePatient(world, data.relatedId);
  if (String(a.ID) === String(b.ID)) throw new Error('Choose a different patient: someone can\'t be their own relative.');
  requireRelationEditor(session, world, a, b);
  var allowed = getLists().relations;
  var relation = cleanRelationWord(data.relation, allowed);
  var reverse = cleanRelationWord(data.reverseRelation, allowed);
  var dup = activeRelations().some(function (r) {
    return (String(r.PatientID) === String(a.ID) && String(r.RelatedID) === String(b.ID)) ||
      (String(r.PatientID) === String(b.ID) && String(r.RelatedID) === String(a.ID));
  });
  if (dup) throw new Error(b.Name + ' is already linked to ' + a.Name + '. Remove that link first to change it.');
  var row = {
    ID: newId(), PatientID: String(a.ID), RelatedID: String(b.ID), Relation: relation, ReverseRelation: reverse,
    CreatedAt: nowIso(), CreatedBy: session.email, CreatedByName: session.name, RemovedAt: '', RemovedBy: '', RemovedReason: ''
  };
  appendObject(getRelationsSheet(), row);
  audit(session, 'link', 'PatientRelation', row.ID,
    { Patient: { from: '', to: String(a.Name) }, Relative: { from: '', to: String(b.Name) }, Relation: { from: '', to: relation }, ReverseRelation: { from: '', to: reverse } },
    'Linked ' + b.Name + ' as ' + a.Name + '\'s ' + relation + ' (' + a.Name + ' is ' + b.Name + '\'s ' + reverse + ')');
  return freshPatientDetail(session, a.ID);
}

// data: { id, patientId (the profile to return), reason? }
function svc_removePatientRelation(session, data) {
  data = data || {};
  var sheet = getRelationsSheet();
  var row = sheetToObjects(sheet).filter(function (r) { return String(r.ID) === String(data.id || '') && !r.RemovedAt; })[0];
  if (!row) throw new Error('That link no longer exists.');
  var world = loadPatientWorld();
  var a = world.byId[String(row.PatientID)];
  var b = world.byId[String(row.RelatedID)];
  if (a && b) requireRelationEditor(session, world, a, b);
  else if (!isTeamSession(session)) throw new ForbiddenError('Only a manager or an admin can remove this link.');
  var reason = cleanText(data.reason || '', 300);
  updateObjectById(sheet, row.ID, { RemovedAt: nowIso(), RemovedBy: session.email, RemovedReason: reason });
  var an = a ? a.Name : row.PatientID, bn = b ? b.Name : row.RelatedID;
  audit(session, 'unlink', 'PatientRelation', row.ID, { Relation: { from: String(row.Relation), to: '' } },
    'Removed the link: ' + bn + ' as ' + an + '\'s ' + row.Relation + (reason ? ' — ' + reason : ''));
  var back = String(data.patientId || row.PatientID);
  return world.byId[back] ? freshPatientDetail(session, back) : { removed: true };
}
