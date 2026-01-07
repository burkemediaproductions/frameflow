export function normalizeClassItem(item) {
  const id = item?.id ?? item?._id ?? item?.uuid ?? null;
  const name = item?.name ?? item?.title ?? item?.class_name ?? "Class";
  const startAt = item?.start_at ?? item?.startAt ?? item?.start_time ?? item?.starts_at ?? null;

  const instructor =
    item?.instructor?.name ??
    item?.teacher?.name ??
    item?.team_member?.name ??
    item?.instructor_name ??
    "";

  const spotsRemaining =
    item?.spots_remaining ??
    item?.spotsRemaining ??
    item?.remaining_spots ??
    item?.capacity_remaining ??
    null;

  return {
    id,
    name,
    start_at: startAt,
    instructor,
    spots_remaining: typeof spotsRemaining === "number"
      ? spotsRemaining
      : (spotsRemaining === null ? null : Number(spotsRemaining)),
    raw: item,
  };
}

export function normalizeTeamMember(item) {
  const id = item?.id ?? item?._id ?? item?.uuid ?? null;
  const name =
    item?.name ??
    [item?.first_name || item?.firstName || "", item?.last_name || item?.lastName || ""]
      .filter(Boolean).join(" ").trim() ||
    "Instructor";

  const bio = item?.bio ?? item?.description ?? item?.about ?? "";
  const photoUrl = item?.photo_url ?? item?.photoUrl ?? item?.image_url ?? item?.avatar_url ?? "";
  const specialties = item?.specialties ?? item?.tags ?? item?.certifications ?? [];

  return {
    id,
    name,
    bio,
    photo_url: photoUrl,
    specialties: Array.isArray(specialties) ? specialties : [],
    raw: item,
  };
}
