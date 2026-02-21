// src/pages/inspection/inspectionConfig.ts

export type InspectionItem = {
  id: string;
  name: string;
  required: boolean;
};

export type InspectionSection = {
  name: string;
  items: InspectionItem[];
};

export type InspectionCategory = {
  category: string; // keep flexible for future categories
  sections: InspectionSection[];
};

/**
 * Seed/default config used by:
 * - InspectionModule UI (to build sectionConfig)
 * - Backend bootstrap (loadInspectionConfig) if DB is empty
 *
 * Structure MUST match:
 * [{ category, sections:[{ name, items:[{id,name,required}] }]}]
 */
export const inspectionListConfig: InspectionCategory[] = [
  {
    category: "Exterior of the Vehicle",
    sections: [
      {
        name: "Front Section",
        items: [
          { id: "front-windshield", name: "Front Windshield", required: true },
          { id: "hood-bonnet", name: "Hood (Bonnet)", required: true },
          { id: "right-side-marker", name: "Right Side Marker Light / Turn Signal Lamp", required: true },
          { id: "left-side-marker", name: "Left Side Marker Light / Turn Signal Lamp", required: true },
          { id: "right-front-fog", name: "Right Front Fog Light", required: true },
          { id: "left-front-fog", name: "Left Front Fog Light", required: true },
          { id: "grille", name: "Grille", required: true },
          { id: "front-bumper", name: "Front Bumper", required: true },
          {
            id: "front-additional",
            name: "Additional: Company Logo, Windshield Wipers, Headlights (High/Low Beams), Parking Sensors, Air Intake.",
            required: false,
          },
        ],
      },
      {
        name: "Left Side (Driver's Side)",
        items: [
          { id: "left-front-fender", name: "Left Front Fender", required: true },
          { id: "left-front-door", name: "Left Front Door", required: true },
          { id: "left-front-tire", name: "Left Front Tire/Wheel", required: true },
          { id: "left-front-rim", name: "Left Front Wheel Rim", required: true },
          { id: "left-side-mirror", name: "Left Side Mirror", required: true },
          { id: "left-pedals", name: "Pedals (not visible, interior)", required: false },
          { id: "left-front-window", name: "Left Front Window (Front Door Glass)", required: true },
          { id: "left-rear-window", name: "Left Rear Window (Rear Door Glass)", required: true },
          { id: "left-rear-door", name: "Left Rear Door (for Sedan/Hatchback)", required: true },
          { id: "left-rear-fender", name: "Left Rear Fender / Quarter Panel", required: true },
          { id: "left-rear-tire", name: "Left Rear Tire/Wheel", required: true },
          { id: "left-rear-rim", name: "Left Rear Wheel Rim", required: true },
          {
            id: "left-side-additional",
            name: "Additional: Door Handle, Trim Molding, Fuel Door (sometimes), Side Turn Signal Lights.",
            required: false,
          },
        ],
      },
      {
        name: "Rear Section",
        items: [
          { id: "trunk-lid", name: "Trunk Lid / Tailgate", required: true },
          { id: "right-tail-light", name: "Right Tail Light (Brake/Turn Signal Light)", required: true },
          { id: "left-tail-light", name: "Left Tail Light (Brake/Turn Signal Light)", required: true },
          { id: "rear-bumper", name: "Rear Bumper", required: true },
          { id: "right-rear-reflector", name: "Right Rear Bumper Reflector / Side Marker", required: true },
          { id: "left-rear-reflector", name: "Left Rear Bumper Reflector / Side Marker", required: true },
          { id: "rear-windshield", name: "Rear Windshield / Back Glass", required: true },
          { id: "rear-spoiler", name: "Rear Spoiler", required: false },
          {
            id: "rear-additional",
            name: "Additional: Company Logo, Rear Wiper, Rearview Camera, Trunk Release Handle, Exhaust Pipe (Muffler/Tailpipe).",
            required: false,
          },
        ],
      },
      {
        name: "Right Side (Passenger Side)",
        items: [
          { id: "right-front-fender", name: "Right Front Fender", required: true },
          { id: "right-front-door", name: "Right Front Door", required: true },
          { id: "right-front-tire", name: "Right Front Tire/Wheel", required: true },
          { id: "right-front-rim", name: "Right Front Wheel Rim", required: true },
          { id: "right-side-mirror", name: "Right Side Mirror", required: true },
          { id: "right-pedals", name: "Pedals (not visible, interior)", required: false },
          { id: "right-front-window", name: "Right Front Window (Front Door Glass)", required: true },
          { id: "right-rear-window", name: "Right Rear Window (Rear Door Glass)", required: true },
          { id: "right-rear-door", name: "Right Rear Door (for Sedan/Hatchback)", required: true },
          { id: "right-rear-fender", name: "Right Rear Fender / Quarter Panel", required: true },
          { id: "right-rear-tire", name: "Right Rear Tire/Wheel", required: true },
          { id: "right-rear-rim", name: "Right Rear Wheel Rim", required: true },
          {
            id: "right-side-additional",
            name: "Additional: Door Handle, Trim Molding, Fuel Door (usually here), Side Turn Signal Lights.",
            required: false,
          },
        ],
      },
      {
        name: "Top Section",
        items: [
          { id: "roof", name: "Roof: Vehicle Roof.", required: true },
          { id: "sunroof", name: "Sunroof / Moonroof: The openable window in the roof.", required: false },
          { id: "top-additional", name: "Additional: Roof Racks, Radio Antenna, Roof Rails.", required: false },
        ],
      },
      {
        name: "General Areas / Undercarriage",
        items: [
          { id: "chassis", name: "Chassis / Underbody: The vehicle's lower frame structure.", required: true },
          { id: "exhaust", name: "Exhaust System: Exhaust pipe and catalytic converter.", required: true },
          { id: "fuel-tank", name: "Fuel Tank: (Usually hidden under the body).", required: true },
          { id: "suspension", name: "Suspension and Supports: Suspension arms and springs.", required: true },
        ],
      },
    ],
  },

  {
    category: "Interior of the Vehicle",
    sections: [
      {
        name: "Driver Side",
        items: [
          { id: "steering-wheel", name: "Steering Wheel & Column (with controls)", required: true },
          { id: "instrument-cluster", name: "Instrument Cluster / Gauges (Speedometer, Tachometer, etc.)", required: true },
          { id: "driver-seat", name: "Driver's Seat & Adjustments", required: true },
          { id: "hud", name: "Head-Up Display (if equipped)", required: false },
          { id: "turn-signal", name: "Turn Signal & Wiper Stalks", required: true },
          { id: "ignition-switch", name: "Ignition Switch / Start Button", required: true },
          { id: "hood-release", name: "Hood Release Lever", required: true },
          { id: "foot-pedals", name: "Foot Pedals (Accelerator, Brake, Clutch)", required: true },
          { id: "dead-pedal", name: "Dead Pedal / Footrest", required: true },
          { id: "driver-door-controls", name: "Driver's Door Controls (Window, Lock, Mirror)", required: true },
          { id: "center-console-driver", name: "Center Console (Driver-side section: cupholders, armrest)", required: true },
          { id: "parking-brake", name: "Parking Brake Lever / Button", required: true },
          { id: "driver-sun-visor", name: "Driver's Sun Visor (with mirror)", required: true },
          { id: "driver-seat-belt", name: "Driver's Seat Belt", required: true },
          { id: "driver-airbag", name: "Driver's Side Airbag", required: true },
          { id: "driver-grab-handle", name: "Driver's Side Grab Handle / \"Oh Shit\" Handle", required: false },
          { id: "knee-airbag", name: "Knee Airbag Panel", required: false },
          { id: "driver-door-pocket", name: "Driver's Door Pocket / Storage Bin", required: true },
          { id: "driver-footwell", name: "Driver's Footwell", required: true },
        ],
      },

      {
        name: "Passenger Side",
        items: [
          { id: "passenger-seat", name: "Passenger Seat & Adjustments", required: true },
          { id: "passenger-sun-visor", name: "Passenger's Sun Visor (with mirror)", required: true },
          { id: "passenger-airbag", name: "Passenger's Side Airbag (in dashboard)", required: true },
          { id: "glove-compartment", name: "Glove Compartment / Box", required: true },
          { id: "passenger-seat-belt", name: "Passenger's Seat Belt", required: true },
          { id: "passenger-grab-handle", name: "Passenger's Side Grab Handle", required: false },
          { id: "passenger-door-pocket", name: "Passenger's Door Pocket / Storage Bin", required: true },
          { id: "passenger-footwell", name: "Passenger's Footwell", required: true },
          { id: "dashboard-passenger", name: "Dashboard (passenger-side section)", required: true },
          { id: "passenger-hvac", name: "Sometimes: Extra HVAC vents or controls", required: false },
        ],
      },

      {
        name: "Left Backside (Behind Driver)",
        items: [
          { id: "rear-left-seat", name: "Rear Left Passenger Seat (Outboard position)", required: true },
          { id: "rear-left-seat-belt", name: "Left Rear Seat Belt(s)", required: true },
          { id: "left-rear-door-pocket", name: "Left Rear Door Pocket / Storage Bin (in door)", required: true },
          { id: "left-rear-door-window", name: "Left Rear Door Window & Controls", required: true },
          { id: "left-rear-latch", name: "Left Rear Child Seat Anchor (LATCH)", required: true },
          { id: "left-rear-airbag", name: "Left Rear Side Airbag / Curtain Airbag", required: true },
          { id: "left-rear-grab", name: "Left Rear Grab Handle", required: true },
          { id: "left-rear-armrest", name: "Left Rear Passenger's Armrest (if individual)", required: false },
          { id: "left-rear-hvac", name: "Left Rear HVAC Vent", required: false },
          { id: "left-rear-reading", name: "Left Rear Reading Light", required: false },
          { id: "left-rear-usb", name: "Left Rear Power Outlet / USB Port (if equipped)", required: false },
          { id: "left-floor-tunnel", name: "Floor Tunnel Hump (left side of it)", required: true },
          { id: "left-rear-footwell", name: "Footwell behind the driver", required: true },
        ],
      },

      {
        name: "Right Backside (Behind Passenger)",
        items: [
          { id: "rear-right-seat", name: "Rear Right Passenger Seat (Outboard position)", required: true },
          { id: "right-rear-seat-belt", name: "Right Rear Seat Belt(s)", required: true },
          { id: "right-rear-door-pocket", name: "Right Rear Door Pocket / Storage Bin (in door)", required: true },
          { id: "right-rear-door-window", name: "Right Rear Door Window & Controls", required: true },
          { id: "right-rear-latch", name: "Right Rear Child Seat Anchor (LATCH)", required: true },
          { id: "right-rear-airbag", name: "Right Rear Side Airbag / Curtain Airbag", required: true },
          { id: "right-rear-grab", name: "Right Rear Grab Handle", required: true },
          { id: "right-rear-armrest", name: "Right Rear Passenger's Armrest (if individual)", required: false },
          { id: "right-rear-hvac", name: "Right Rear HVAC Vent", required: false },
          { id: "right-rear-reading", name: "Right Rear Reading Light", required: false },
          { id: "right-rear-usb", name: "Right Rear Power Outlet / USB Port (if equipped)", required: false },
          { id: "right-floor-tunnel", name: "Floor Tunnel Hump (right side of it)", required: true },
          { id: "right-rear-footwell", name: "Footwell behind the front passenger", required: true },
        ],
      },

      {
        name: "Central / Shared",
        items: [
          {
            id: "center-stack",
            name: "Center Stack / Dashboard Center: Infotainment Screen, Head Unit, Climate Control System, Central HVAC Vents, Clock, Hazard Light Button.",
            required: true,
          },
          {
            id: "center-console",
            name: "Center Console Area: Gear Shifter / Selector, Central Armrest (shared), Primary Cupholders, Storage Tray/Cubby, Wireless Charger, Drive Mode Selectors.",
            required: true,
          },
          {
            id: "overhead-console",
            name: "Overhead Console: Primary Dome/Map Lights, Sunglasses Holder, Garage Door Openers, Microphone(s).",
            required: false,
          },
          {
            id: "rear-center",
            name: "Rear Center (for 5-seat layouts): Middle Seat & Seat Belt (if bench), Fold-Down Center Armrest (with cupholders/vents), Rear Central HVAC Vent, Shared Power Outlets.",
            required: false,
          },
          {
            id: "general-floor",
            name: "General Floor: Carpeting, Full-Width Floor Mats, Transmission Tunnel/Hump.",
            required: true,
          },
        ],
      },
    ],
  },
];

export default inspectionListConfig;