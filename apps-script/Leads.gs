// Leads.gs — the lead journey: who the customer is, how they reached us,
// every contact attempt, and whether they bought (or why not).
//
// Two tabs, both created automatically on first use:
//   Leads           one row per prospective customer
//   LeadActivities  one row per call / WhatsApp / visit / note on a lead
//
// Contact attempts are never typed in — they're counted from LeadActivities.
// A lead becomes "Converted" only by creating a sale from it (see
// svc_createSale in SalesService.gs), so the sale and lead stay linked.
//
// Access: agents see and edit only leads they own; managers and admins see
// all leads and can reassign them. Enforced here, not just in the browser.

var LEAD_HEADERS = ['ID', 'Name', 'Contact', 'ContactKey', 'OwnerEmail', 'OwnerName', 'Interest', 'Direction',
  'Channel', 'HeardFrom', 'Temperature', 'Stage', 'LostReason', 'NextFollowUp', 'Consent', 'DoNotCall', 'Notes',
  'ConvertedSaleType', 'ConvertedSaleID', 'CreatedByEmail', 'CreatedAt', 'UpdatedAt'];
var ACTIVITY_HEADERS = ['ID', 'LeadID', 'Date', 'ByEmail', 'ByName', 'Type', 'Direction', 'Outcome', 'Notes', 'NextFollowUp'];

var LEAD_STAGES = ['New', 'Contacted', 'Interested', 'Follow-up', 'Converted', 'Lost'];
var LEAD_OPEN_STAGES = ['New', 'Contacted', 'Interested', 'Follow-up'];
var LEAD_TEMPERATURES = ['Hot', 'Warm', 'Cold'];
var LEAD_INTERESTS = ['Medpass', 'Pharmacy', 'Both'];
var LEAD_DIRECTIONS = ['Inbound', 'Outbound'];
var ACTIVITY_TYPES = ['Call', 'WhatsApp', 'Visit', 'SMS', 'Email', 'Note'];
var ACTIVITY_DIRECTIONS = ['Outgoing', 'Incoming'];
var ACTIVITY_OUTCOMES = ['Connected', 'No answer', 'Call back later', 'Interested', 'Not interested', 'Wrong number'];
// Contact types that count as "reaching out" — blocked when a lead is marked Do Not Call.
var DND_BLOCKED_TYPES = ['Call', 'WhatsApp', 'SMS'];

// ===== Editable dropdown lists (admin) =====
var DEFAULT_LISTS = {
  channels: ['Phone call', 'Walk-in', 'WhatsApp', 'Website form', 'Health camp', 'OPD/IPD referral', 'Other'],
  heardFrom: ['Google search', 'Facebook / Instagram', 'Newspaper', 'Hoarding / banner', 'Existing patient',
    'Doctor referral', 'Health camp', 'Friend or family', 'Other'],
  lostReasons: ['Price too high', 'Already has a provider', 'Not reachable', 'Wrong number', 'Not interested', 'Other']
};

function getListsSheet() { return getOrCreateSheet('Lists', ['Key', 'Values']); }

function getLists() {
  var lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
  sheetToObjects(getListsSheet()).forEach(function (row) {
    if (!lists.hasOwnProperty(row.Key)) return;
    try {
      var v = JSON.parse(row.Values);
      if (Array.isArray(v) && v.length) lists[row.Key] = v;
    } catch (e) { /* keep default */ }
  });
  return lists;
}

function svc_getLists(session) {
  var lists = getLists();
  // Fixed options are sent too, so the browser never hard-codes them.
  lists.stages = LEAD_STAGES;
  lists.temperatures = LEAD_TEMPERATURES;
  lists.interests = LEAD_INTERESTS;
  lists.directions = LEAD_DIRECTIONS;
  lists.activityTypes = ACTIVITY_TYPES;
  lists.activityDirections = ACTIVITY_DIRECTIONS;
  lists.outcomes = ACTIVITY_OUTCOMES;
  return lists;
}

function svc_updateLists(session, data) {
  requireRole(session, ['admin']);
  var sheet = getListsSheet();
  var before = getLists();
  Object.keys(DEFAULT_LISTS).forEach(function (key) {
    if (data[key] === undefined) return;
    if (!Array.isArray(data[key])) throw new Error('List "' + key + '" must be a list of options.');
    var seen = {};
    var clean = data[key].map(function (v) { return String(v || '').trim(); }).filter(function (v) {
      if (!v || seen[v.toLowerCase()]) return false;
      seen[v.toLowerCase()] = true;
      return true;
    });
    if (clean.length === 0) throw new Error('List "' + key + '" needs at least one option.');
    if (clean.length > 40) throw new Error('List "' + key + '" can have at most 40 options.');
    clean.forEach(function (v) { if (v.length > 50) throw new Error('Options must be 50 characters or less: "' + v + '"'); });

    var rows = sheetToObjects(sheet);
    var at = rows.findIndex(function (r) { return r.Key === key; });
    if (at !== -1) {
      sheet.getRange(at + 2, 1, 1, 2).setValues([[key, JSON.stringify(clean)]]);
    } else {
      appendObject(sheet, { Key: key, Values: JSON.stringify(clean) });
    }
  });
  var after = getLists();
  audit(session, 'update_lists', 'Lists', '', auditDiff(
    { channels: before.channels.join(', '), heardFrom: before.heardFrom.join(', '), lostReasons: before.lostReasons.join(', ') },
    { channels: after.channels.join(', '), heardFrom: after.heardFrom.join(', '), lostReasons: after.lostReasons.join(', ') }));
  return svc_getLists(session);
}

// ===== Helpers =====
function getLeadsSheet() { return getOrCreateSheet('Leads', LEAD_HEADERS); }
function getActivitiesSheet() { return getOrCreateSheet('LeadActivities', ACTIVITY_HEADERS); }

// Phone numbers are compared on their last 10 digits, so "+91 98480 12345",
// "098480-12345" and "9848012345" are all the same customer.
function phoneKey(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function asBool(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

function canAccessLead(session, lead) {
  if (session.role !== 'agent') return true;
  return String(lead.OwnerEmail).toLowerCase() === String(session.email).toLowerCase();
}

function findLead(id) {
  return sheetToObjects(getLeadsSheet()).find(function (l) { return String(l.ID) === String(id); }) || null;
}

function requireLead(session, id) {
  var lead = findLead(id);
  if (!lead || !canAccessLead(session, lead)) throw new Error('Lead not found.');
  return lead;
}

function requireOneOf(value, allowed, label) {
  if (allowed.indexOf(value) === -1) throw new Error(label + ' must be one of: ' + allowed.join(', ') + '.');
}

function optionalDateKey(value, label) {
  var v = String(value || '').trim();
  if (!v) return '';
  if (!isDateKey(v)) throw new Error(label + ' must be a valid date (YYYY-MM-DD).');
  return v;
}

function followUpStatus(lead) {
  if (LEAD_OPEN_STAGES.indexOf(lead.Stage) === -1) return '';
  var key = dateKey(lead.NextFollowUp);
  if (!isDateKey(key)) return '';
  var diff = keyToDayNumber(key) - keyToDayNumber(todayKey());
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'upcoming';
}

// activities: this lead's activity rows (any order)
function leadForClient(lead, activities) {
  activities = activities || [];
  var outgoing = activities.filter(function (a) { return a.Direction === 'Outgoing'; });
  var last = activities.reduce(function (max, a) {
    return (!max || new Date(a.Date) > new Date(max)) ? a.Date : max;
  }, null);
  return {
    ID: lead.ID,
    Name: lead.Name,
    Contact: lead.Contact,
    OwnerEmail: lead.OwnerEmail,
    OwnerName: lead.OwnerName,
    Interest: lead.Interest,
    Direction: lead.Direction,
    Channel: lead.Channel,
    HeardFrom: lead.HeardFrom,
    Temperature: lead.Temperature,
    Stage: lead.Stage,
    LostReason: lead.LostReason,
    NextFollowUp: dateKey(lead.NextFollowUp),
    FollowUpStatus: followUpStatus(lead),
    Consent: asBool(lead.Consent),
    DoNotCall: asBool(lead.DoNotCall),
    Notes: lead.Notes,
    ConvertedSaleType: lead.ConvertedSaleType,
    ConvertedSaleID: lead.ConvertedSaleID,
    AttemptCount: outgoing.length,
    ActivityCount: activities.filter(function (a) { return a.Type !== 'Sale'; }).length,
    LastActivityAt: last ? (Object.prototype.toString.call(last) === '[object Date]' ? last.toISOString() : String(last)) : '',
    CreatedAt: lead.CreatedAt,
    UpdatedAt: lead.UpdatedAt
  };
}

function activityForClient(a) {
  return {
    ID: a.ID, LeadID: a.LeadID,
    Date: Object.prototype.toString.call(a.Date) === '[object Date]' ? a.Date.toISOString() : String(a.Date),
    ByName: a.ByName, ByEmail: a.ByEmail, Type: a.Type, Direction: a.Direction,
    Outcome: a.Outcome, Notes: a.Notes, NextFollowUp: dateKey(a.NextFollowUp)
  };
}

function activitiesByLead() {
  var map = {};
  sheetToObjects(getActivitiesSheet()).forEach(function (a) {
    (map[a.LeadID] = map[a.LeadID] || []).push(a);
  });
  return map;
}

function addActivity(session, leadId, fields) {
  var row = Object.assign({
    ID: newId(), LeadID: leadId, Date: nowIso(),
    ByEmail: session.email, ByName: session.name,
    Type: '', Direction: '', Outcome: '', Notes: '', NextFollowUp: ''
  }, fields);
  appendObject(getActivitiesSheet(), row);
  return row;
}

// An open lead with this phone number, other than `exceptId`.
function findOpenLeadByPhone(key, exceptId) {
  if (!key) return null;
  return sheetToObjects(getLeadsSheet()).find(function (l) {
    return String(l.ContactKey) === key && String(l.ID) !== String(exceptId || '') &&
      LEAD_OPEN_STAGES.indexOf(l.Stage) !== -1;
  }) || null;
}

function duplicateLeadError(session, existing) {
  var mine = canAccessLead(session, existing);
  return new Error('This number already has an open lead: ' + existing.Name + ' (' + existing.Stage + ', owned by ' +
    existing.OwnerName + ').' + (mine ? ' Open that lead instead of creating a new one.' : ' Ask a manager if it should be reassigned to you.'));
}

// ===== Reads =====
function svc_listLeads(session) {
  var acts = activitiesByLead();
  var leads = sheetToObjects(getLeadsSheet())
    .filter(function (l) { return canAccessLead(session, l); })
    .map(function (l) { return leadForClient(l, acts[l.ID]); });

  var rank = { overdue: 0, today: 1, upcoming: 2, '': 3 };
  leads.sort(function (a, b) {
    var ao = LEAD_OPEN_STAGES.indexOf(a.Stage) !== -1 ? 0 : 1;
    var bo = LEAD_OPEN_STAGES.indexOf(b.Stage) !== -1 ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (rank[a.FollowUpStatus] !== rank[b.FollowUpStatus]) return rank[a.FollowUpStatus] - rank[b.FollowUpStatus];
    if (a.NextFollowUp && b.NextFollowUp && a.NextFollowUp !== b.NextFollowUp) return a.NextFollowUp < b.NextFollowUp ? -1 : 1;
    return new Date(b.CreatedAt) - new Date(a.CreatedAt);
  });
  return leads;
}

function svc_getLead(session, id) {
  var lead = requireLead(session, id);
  var acts = sheetToObjects(getActivitiesSheet())
    .map(function (a, i) { a._row = i; return a; })
    .filter(function (a) { return String(a.LeadID) === String(lead.ID); });
  // Newest first; activities logged in the same second keep sheet order (later row = newer).
  acts.sort(function (a, b) { return (new Date(b.Date) - new Date(a.Date)) || (b._row - a._row); });
  return { lead: leadForClient(lead, acts), activities: acts.map(activityForClient) };
}

// Used by the New Lead form as soon as a phone number is typed: is this
// person already a lead or an existing customer? Agents only learn that a
// lead exists and who owns it — not its details — if it isn't theirs.
function svc_checkContact(session, contact, exceptId) {
  var key = phoneKey(contact);
  if (!key) return { leads: [], salesCount: 0 };
  var leads = sheetToObjects(getLeadsSheet()).filter(function (l) {
    return String(l.ContactKey) === key && String(l.ID) !== String(exceptId || '');
  }).map(function (l) {
    var visible = canAccessLead(session, l);
    return { ID: visible ? l.ID : '', Name: visible ? l.Name : '', OwnerName: l.OwnerName, Stage: l.Stage, Open: LEAD_OPEN_STAGES.indexOf(l.Stage) !== -1, Mine: visible };
  });
  var salesCount = 0;
  ['Medpass', 'Pharmacy'].forEach(function (name) {
    sheetToObjects(getSheetByName(name)).forEach(function (s) { if (phoneKey(s.Contact) === key) salesCount++; });
  });
  return { leads: leads, salesCount: salesCount };
}

// ===== Writes =====
function cleanLeadFields(data, lists, isCreate) {
  var out = {};
  if (data.name !== undefined || isCreate) {
    out.Name = String(data.name || '').trim();
    if (!out.Name) throw new Error('Name is required.');
  }
  if (data.contact !== undefined || isCreate) {
    out.Contact = String(data.contact || '').trim();
    if (!phoneKey(out.Contact)) throw new Error('A valid phone number is required.');
    out.ContactKey = phoneKey(out.Contact);
  }
  if (data.interest !== undefined || isCreate) { out.Interest = String(data.interest || 'Both'); requireOneOf(out.Interest, LEAD_INTERESTS, 'Interest'); }
  if (data.direction !== undefined || isCreate) { out.Direction = String(data.direction || 'Inbound'); requireOneOf(out.Direction, LEAD_DIRECTIONS, 'Who started the contact'); }
  if (data.channel !== undefined || isCreate) { out.Channel = String(data.channel || ''); requireOneOf(out.Channel, lists.channels, 'Channel'); }
  if (data.heardFrom !== undefined || isCreate) {
    out.HeardFrom = String(data.heardFrom || '');
    if (out.HeardFrom) requireOneOf(out.HeardFrom, lists.heardFrom, 'How they heard about us');
  }
  if (data.temperature !== undefined || isCreate) { out.Temperature = String(data.temperature || 'Warm'); requireOneOf(out.Temperature, LEAD_TEMPERATURES, 'Temperature'); }
  if (data.nextFollowUp !== undefined) out.NextFollowUp = optionalDateKey(data.nextFollowUp, 'Next follow-up');
  if (data.consent !== undefined) out.Consent = !!data.consent && data.consent !== 'false';
  if (data.doNotCall !== undefined) out.DoNotCall = !!data.doNotCall && data.doNotCall !== 'false';
  if (data.notes !== undefined) out.Notes = String(data.notes || '').trim().slice(0, 2000);
  return out;
}

function resolveOwner(session, ownerEmail) {
  if (!ownerEmail || session.role === 'agent') return { email: session.email, name: session.name };
  var user = sheetToObjects(getSheetByName('Users')).find(function (u) {
    return String(u.Email).toLowerCase() === String(ownerEmail).toLowerCase() && isActive(u.Active);
  });
  if (!user) throw new Error('Owner not found or inactive.');
  return { email: user.Email, name: user.Name };
}

function svc_createLead(session, data) {
  var lists = getLists();
  var fields = cleanLeadFields(data, lists, true);
  if (fields.Direction === 'Outbound') fields.HeardFrom = '';
  var existing = findOpenLeadByPhone(fields.ContactKey);
  if (existing) throw duplicateLeadError(session, existing);

  var owner = resolveOwner(session, data.ownerEmail);
  var lead = Object.assign({
    ID: newId(),
    OwnerEmail: owner.email,
    OwnerName: owner.name,
    Stage: 'New',
    LostReason: '',
    NextFollowUp: '',
    Consent: false,
    DoNotCall: false,
    Notes: '',
    ConvertedSaleType: '',
    ConvertedSaleID: '',
    CreatedByEmail: session.email,
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  }, fields);
  appendObject(getLeadsSheet(), lead);
  audit(session, 'create', 'Lead', lead.ID, auditDiff(null, lead));
  return leadForClient(lead, []);
}

function svc_updateLead(session, id, data) {
  var lead = requireLead(session, id);
  if (lead.Stage === 'Converted' && session.role === 'agent') {
    throw new ForbiddenError('This lead is converted to a sale and locked. Ask a manager to make changes.');
  }
  var lists = getLists();
  var patch = cleanLeadFields(data, lists, false);

  if (patch.ContactKey && patch.ContactKey !== String(lead.ContactKey)) {
    var dup = findOpenLeadByPhone(patch.ContactKey, lead.ID);
    if (dup) throw duplicateLeadError(session, dup);
  }
  if ((patch.Direction || lead.Direction) === 'Outbound') patch.HeardFrom = '';

  if (data.stage !== undefined && data.stage !== lead.Stage) {
    var stage = String(data.stage);
    if (stage === 'Converted') throw new Error('A lead becomes Converted by creating a sale from it (Convert to sale).');
    requireOneOf(stage, LEAD_STAGES, 'Stage');
    patch.Stage = stage;
  }
  var finalStage = patch.Stage || lead.Stage;
  if (finalStage === 'Lost') {
    var reason = data.lostReason !== undefined ? String(data.lostReason) : String(lead.LostReason || '');
    requireOneOf(reason, lists.lostReasons, 'Lost reason');
    patch.LostReason = reason;
    patch.NextFollowUp = '';
  } else if (lead.LostReason) {
    patch.LostReason = '';
  }

  patch.UpdatedAt = nowIso();
  var updated = updateObjectById(getLeadsSheet(), lead.ID, patch);
  audit(session, 'update', 'Lead', lead.ID, auditDiff(lead, patch));
  return svc_getLead(session, updated.ID);
}

// What an outcome does to the lead's stage (only while the lead is open).
function stageAfterOutcome(currentStage, outcome) {
  if (outcome === 'Not interested' || outcome === 'Wrong number') return 'Lost';
  if (outcome === 'Interested') return 'Interested';
  if (outcome === 'Call back later') return 'Follow-up';
  return currentStage === 'New' ? 'Contacted' : currentStage;
}

function svc_logActivity(session, leadId, data) {
  var lead = requireLead(session, leadId);
  var type = String(data.type || '');
  var direction = String(data.direction || '');
  var outcome = String(data.outcome || '');
  requireOneOf(type, ACTIVITY_TYPES, 'Type');
  if (type !== 'Note') {
    requireOneOf(direction, ACTIVITY_DIRECTIONS, 'Direction');
    requireOneOf(outcome, ACTIVITY_OUTCOMES, 'Outcome');
  } else {
    direction = '';
    outcome = '';
    if (!String(data.notes || '').trim()) throw new Error('A note needs some text.');
  }
  if (asBool(lead.DoNotCall) && direction === 'Outgoing' && DND_BLOCKED_TYPES.indexOf(type) !== -1) {
    throw new ForbiddenError('This customer is marked Do Not Call. Only record contact they started (Incoming), or remove the flag if they have agreed to be contacted.');
  }
  var nextFollowUp = optionalDateKey(data.nextFollowUp, 'Next follow-up');

  var activity = addActivity(session, lead.ID, {
    Type: type, Direction: direction, Outcome: outcome,
    Notes: String(data.notes || '').trim().slice(0, 2000), NextFollowUp: nextFollowUp
  });

  var patch = { UpdatedAt: nowIso() };
  if (LEAD_OPEN_STAGES.indexOf(lead.Stage) !== -1 && type !== 'Note') {
    var newStage = stageAfterOutcome(lead.Stage, outcome);
    if (newStage !== lead.Stage) patch.Stage = newStage;
    if (newStage === 'Lost') {
      var lists = getLists();
      patch.LostReason = lists.lostReasons.indexOf(outcome) !== -1 ? outcome : (lists.lostReasons.indexOf('Other') !== -1 ? 'Other' : lists.lostReasons[0]);
      patch.NextFollowUp = '';
    }
  }
  if (nextFollowUp && (patch.Stage || lead.Stage) !== 'Lost') patch.NextFollowUp = nextFollowUp;
  updateObjectById(getLeadsSheet(), lead.ID, patch);

  audit(session, 'log_activity', 'Lead', lead.ID, auditDiff(lead, patch));
  return svc_getLead(session, lead.ID);
}

function svc_reassignLead(session, id, agentEmail) {
  requireRole(session, ['admin', 'manager']);
  var lead = findLead(id);
  if (!lead) throw new Error('Lead not found.');
  var agent = sheetToObjects(getSheetByName('Users')).find(function (u) {
    return String(u.Email).toLowerCase() === String(agentEmail).toLowerCase() && u.Role === 'agent' && isActive(u.Active);
  });
  if (!agent) throw new Error('Target agent not found or inactive.');
  var patch = { OwnerEmail: agent.Email, OwnerName: agent.Name, UpdatedAt: nowIso() };
  updateObjectById(getLeadsSheet(), lead.ID, patch);
  addActivity(session, lead.ID, { Type: 'Note', Notes: 'Reassigned from ' + lead.OwnerName + ' to ' + agent.Name + '.' });
  audit(session, 'reassign', 'Lead', lead.ID, auditDiff(lead, patch));
  return svc_getLead(session, lead.ID);
}

// ===== Called from SalesService.gs =====
// Validates that a sale may be created from this lead. Returns the lead.
function leadForConversion(session, leadId) {
  var lead = requireLead(session, leadId);
  if (lead.Stage === 'Converted') throw new Error('This lead has already been converted to a sale.');
  return lead;
}

function markLeadConverted(session, lead, saleType, sale) {
  var patch = { Stage: 'Converted', ConvertedSaleType: saleType, ConvertedSaleID: sale.ID, NextFollowUp: '', LostReason: '', UpdatedAt: nowIso() };
  updateObjectById(getLeadsSheet(), lead.ID, patch);
  addActivity(session, lead.ID, { Type: 'Sale', Outcome: 'Converted', Notes: 'Converted to ' + saleType + ' sale (₹' + sale.Amount + ').' });
  audit(session, 'convert', 'Lead', lead.ID, auditDiff(lead, patch));
}

// If a sale created from a lead is deleted, reopen the lead.
function unlinkLeadFromSale(session, leadId, saleType) {
  var lead = findLead(leadId);
  if (!lead || lead.Stage !== 'Converted') return;
  var patch = { Stage: 'Interested', ConvertedSaleType: '', ConvertedSaleID: '', UpdatedAt: nowIso() };
  updateObjectById(getLeadsSheet(), lead.ID, patch);
  addActivity(session, lead.ID, { Type: 'Note', Notes: 'Linked ' + saleType + ' sale was deleted — lead reopened.' });
  audit(session, 'unconvert', 'Lead', lead.ID, auditDiff(lead, patch));
}
