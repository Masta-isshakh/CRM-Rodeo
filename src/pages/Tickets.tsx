import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";


const client = generateClient<Schema>();


export default function Tickets({ permissions }: PageProps) {
const [tickets, setTickets] = useState<any[]>([]);


useEffect(() => {
client.models.Ticket.list().then(({ data }) => {
setTickets(data);
});
}, []);


return (
<div>
<h2>Support Tickets</h2>
<ul>
{tickets.map((t) => (
<li key={t.id}>{t.title} – {t.status}</li>
))}
</ul>
</div>
);
}