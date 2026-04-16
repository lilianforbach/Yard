import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { ExternalLink, Mail, ChevronRight, MessageSquare, PencilLine, UserPlus } from 'lucide-react';
import { formatDate } from '../../lib/constants';
import { getPersonLastUpdated } from '../../lib/maintenance';
import { getProjectTeamMemberIds } from '../../lib/projectTeam';
import {
  buildPersonLinks,
  getLinkDisplayText,
  getPersonLinkLabel,
} from '../../lib/personLinks';
import {
  buildSkillResolverContext,
  resolveCanonicalSkill,
} from '../../lib/skills';
import SlidePanel from './SlidePanel';
import EditableField from './EditableField';
import PersonProfileModal from './PersonProfileModal';
import CreatePersonAccessModal from './CreatePersonAccessModal';

export default function PersonPanel({ personId, onClose, onProjectClick }) {
  const { people, institutions, getPerson, getInstitution, projects, refreshResources } = useData();
  const { canEditPerson, permissions } = useAuth();
  const { showToast } = useToast();
  const person = getPerson(personId);
  const editable = canEditPerson(personId);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showCreateAccess, setShowCreateAccess] = useState(false);
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [adminAccountsReady, setAdminAccountsReady] = useState(false);

  useEffect(() => {
    let ignore = false;
    if (!permissions?.isAdmin) {
      setAdminAccounts([]);
      setAdminAccountsReady(false);
      return undefined;
    }

    setAdminAccountsReady(false);
    api.get('/admin/users')
      .then((res) => {
        if (ignore) return;
        setAdminAccounts(res.data || []);
        setAdminAccountsReady(true);
      })
      .catch(() => {
        if (ignore) return;
        setAdminAccounts([]);
        setAdminAccountsReady(false);
      });

    return () => {
      ignore = true;
    };
  }, [permissions?.isAdmin]);

  const skillResolver = useMemo(() => (
    buildSkillResolverContext(people)
  ), [people]);

  const displayedSkills = useMemo(() => (
    Array.from(new Set((person?.skills || [])
      .map((skill) => resolveCanonicalSkill(skill, skillResolver))
      .filter(Boolean)))
  ), [person?.skills, skillResolver]);

  const externalLinks = useMemo(() => (
    buildPersonLinks(person).map((link, index) => ({
      key: `${link.type}-${index}`,
      type: link.type,
      label: getPersonLinkLabel(link),
      url: link.url,
    }))
  ), [person]);

  const handleProfileSaved = useCallback(async () => {
    await refreshResources(['people']);
    setShowProfileEditor(false);
    showToast('Profile updated');
  }, [refreshResources, showToast]);

  const saveField = useCallback(async (field, value) => {
    await api.put(`/people/${personId}`, { [field]: value });
    await refreshResources(['people']);
    showToast('Profile updated');
  }, [personId, refreshResources, showToast]);

  const handleAccountCreated = useCallback(async (result) => {
    await refreshResources(['people']);
    if (result?.user?.id) {
      setAdminAccounts((current) => {
        const remaining = current.filter((account) => account.id !== result.user.id);
        return [...remaining, result.user];
      });
      setAdminAccountsReady(true);
    }
    setShowCreateAccess(false);
    showToast('Invite link ready');
  }, [refreshResources, showToast]);

  if (!person) return null;
  const inst = getInstitution(person.institution);
  const profileUpdatedAt = getPersonLastUpdated(person);
  const hasResearchInterests = Boolean(person?.researchDescription?.trim());
  const equipmentItems = person?.equipment || [];
  const hasEquipment = equipmentItems.length > 0;
  const linkedAccount = permissions?.isAdmin
    ? adminAccounts.find((account) => (
      account.linkedPersonId === person.id
      || (
        (account.email || '').toLowerCase().trim()
        && (person.email || '').toLowerCase().trim()
        && account.email.toLowerCase().trim() === person.email.toLowerCase().trim()
      )
    )) || null
    : null;
  const showCreateAccessAction = Boolean(
    permissions?.isAdmin
    && adminAccountsReady
    && (!linkedAccount || linkedAccount.activationPending)
  );
  const createAccessLabel = linkedAccount?.activationPending ? 'Copy Invite' : 'Invite to Yard';

  const personProjects = projects.filter((project) => getProjectTeamMemberIds(project).includes(person.id));

  const header = (
    <>
      <h2>{person.name}</h2>
      {person.title?.trim() && (
        <div className="panel-title">{person.title}</div>
      )}
      <div className="panel-meta">
        <span className="inst-badge" style={{ color: inst?.color }}>{inst?.name}</span>
      </div>
      {profileUpdatedAt && (
        <div className="panel-freshness">Profile updated {formatDate(profileUpdatedAt)}</div>
      )}
      {(editable || showCreateAccessAction) && (
        <div className="panel-header-actions">
          {editable && (
            <button
              data-testid="person-edit-profile"
              type="button"
              className="action-btn small"
              onClick={() => setShowProfileEditor(true)}
            >
              <PencilLine size={14} /> Edit Profile
            </button>
          )}
          {showCreateAccessAction && (
            <button
              data-testid="person-create-access"
              type="button"
              className="action-btn small secondary"
              onClick={() => setShowCreateAccess(true)}
            >
              <UserPlus size={14} /> {createAccessLabel}
            </button>
          )}
        </div>
      )}
      <div className="panel-contact-links">
        {person.email && person.showTeamsChat !== false && (
          <a href={`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(person.email)}`} target="_blank" rel="noreferrer" className="panel-contact-btn teams-btn">
            <MessageSquare size={15} /> Teams Chat
          </a>
        )}
        {person.email && person.showEmail !== false && (
          <a href={`mailto:${person.email}`} className="panel-contact-btn email-btn">
            <Mail size={15} /> {person.email}
          </a>
        )}
      </div>
    </>
  );

  return (
    <SlidePanel
      onClose={onClose}
      testId="person-panel"
      headerStyle={{ borderBottomColor: inst?.color || '#E5E7EB' }}
      headerContent={header}
      ariaLabel={`${person.name} profile`}
    >
      {hasResearchInterests && (
        <div className="panel-section">
          <h4>Research interests</h4>
        <EditableField
          value={person.researchDescription}
          canEdit={editable}
          multiline
          onSave={(v) => saveField('researchDescription', v)}
          showSaveModes={false}
          placeholder="Add research interests"
          className="panel-research-copy"
          editorTitle="Edit Research Interests"
          editorSubtitle="Use this to describe the themes, questions, and approaches you want people to associate with your work."
          />
        </div>
      )}

      {personProjects.length > 0 && (
        <div className="panel-section">
          <h4>Projects</h4>
          {personProjects.map(p => (
            <button
              key={p.id}
              type="button"
              className="panel-project-link"
              onClick={() => onProjectClick?.(p.id)}
            >
              <span className="project-dot" style={{ backgroundColor: getInstitution(p.institution)?.color }} />
              {p.title} <ChevronRight size={12} className="clickable-chevron" />
            </button>
          ))}
        </div>
      )}

      {displayedSkills.length > 0 && (
        <div className="panel-section">
          <h4>Happy to help with</h4>
          <div className="skill-tags">
            {displayedSkills.map((skill) => <span key={skill} className="skill-tag">{skill}</span>)}
          </div>
        </div>
      )}

      {hasEquipment && (
        <div className="panel-section">
          <h4>Can advise on equipment</h4>
          <div className="equipment-list-panel">
            {equipmentItems.map((eq, i) => (
              <div key={i} className="equipment-item-panel">
                <div className="equipment-item-name">{eq.name}</div>
                {eq.description && <div className="equipment-item-desc">{eq.description}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {externalLinks.length > 0 && (
        <div className="panel-section panel-links-section">
          <h4>Links</h4>
          <div className="profile-links-list">
            {externalLinks.map((link) => (
              <a
                key={link.key}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="profile-link-row"
              >
                <div className="profile-link-copy">
                  <span className="profile-link-label">{link.label}</span>
                  <span className="profile-link-value">{getLinkDisplayText(link.key, link.url)}</span>
                </div>
                <ExternalLink size={14} className="profile-link-icon" />
              </a>
            ))}
          </div>
        </div>
      )}

      {showProfileEditor && (
        <PersonProfileModal
          person={person}
          institutions={institutions}
          canEditIdentity={Boolean(permissions?.isAdmin)}
          onClose={() => setShowProfileEditor(false)}
          onSaved={handleProfileSaved}
        />
      )}

      {showCreateAccess && (
        <CreatePersonAccessModal
          person={person}
          account={linkedAccount}
          onClose={() => setShowCreateAccess(false)}
          onCreated={handleAccountCreated}
        />
      )}
    </SlidePanel>
  );
}
