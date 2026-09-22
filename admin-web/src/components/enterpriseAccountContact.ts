export interface OrganizationContactValues {
  contactName: string;
  contactEmail: string;
}

export interface OrganizationContactUpdatePayload {
  contactName: string;
  contactEmail: string;
}

export function createOrganizationContactDraft(
  values: Partial<OrganizationContactValues>,
): OrganizationContactValues {
  return {
    contactName: values.contactName ?? "",
    contactEmail: values.contactEmail ?? "",
  };
}

export function validateOrganizationContact(
  values: OrganizationContactValues,
): { payload: OrganizationContactUpdatePayload } | { error: string } {
  const contactName = values.contactName.trim();
  if (!contactName) {
    return { error: "Contact name is required." };
  }

  const contactEmail = values.contactEmail.trim();
  if (!contactEmail) {
    return { error: "Contact email is required." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { error: "Enter a valid contact email address." };
  }

  return {
    payload: {
      contactName,
      contactEmail,
    },
  };
}
