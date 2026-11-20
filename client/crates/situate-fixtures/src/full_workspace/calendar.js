export default function defineService() {
  return {
    exports: {
      listEvents: () => [
        { title: "Volunteer setup", when: "25 April · 09:30" },
        { title: "Spring open day", when: "25 April · 10:00–13:00" },
      ],
    },
  };
}
