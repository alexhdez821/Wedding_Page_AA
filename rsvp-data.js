// Mock guest list dataset.
// Replace this array with backend data later.
export const guestList = [
  {
    id: "g-101",
    firstName: "Mariana",
    lastName: "Lopez",
    partyId: "p-100",
    invitedGuests: [
      { id: "p-100-1", firstName: "Mariana", lastName: "Lopez", rsvpStatus: "pending" },
      { id: "p-100-2", firstName: "Carlos", lastName: "Lopez", rsvpStatus: "pending" }
    ],
    canBringPlusOne: false,
    plusOneName: "",
    rsvpStatus: "pending"
  },
  {
    id: "g-102",
    firstName: "Daniel",
    lastName: "Martinez",
    partyId: "p-200",
    invitedGuests: [
      { id: "p-200-1", firstName: "Daniel", lastName: "Martinez", rsvpStatus: "pending" }
    ],
    canBringPlusOne: true,
    plusOneName: "",
    rsvpStatus: "pending"
  },
  {
    id: "g-103",
    firstName: "Sofia",
    lastName: "Ramirez",
    partyId: "p-300",
    invitedGuests: [
      { id: "p-300-1", firstName: "Sofia", lastName: "Ramirez", rsvpStatus: "pending" },
      { id: "p-300-2", firstName: "Diego", lastName: "Ramirez", rsvpStatus: "pending" },
      { id: "p-300-3", firstName: "Camila", lastName: "Ramirez", rsvpStatus: "pending" }
    ],
    canBringPlusOne: false,
    plusOneName: "",
    rsvpStatus: "pending"
  }
];

export const RSVP_STATUS = {
  ATTENDING: "attending",
  NOT_ATTENDING: "not attending",
  PENDING: "pending"
};
