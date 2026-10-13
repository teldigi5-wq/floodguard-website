import Image from "next/image";
import {Activity,BookOpen,HeartHandshake,ShieldCheck,Users} from "lucide-react";
import {CTA,PageHero} from "@/components/page-kit";

export default function About(){
 return <main className="page">
  <PageHero eyebrow="Group WD26 · About the project" title="FloodGuard turns field signals into understandable action." copy="A student-built environmental IoT prototype by Poojana Kaveesh for dam water monitoring, local flood warnings and automated gate response."/>
  <section className="brand-signature" aria-labelledby="brand-purpose">
   <div><p className="eyebrow">Official FloodGuard identity</p><h2 id="brand-purpose">Monitor. Predict. Protect.</h2><p>The FloodGuard shield brings together the project&apos;s core ideas: connected sensing, rising water awareness and a dam gate designed to respond when conditions become dangerous.</p><div className="brand-swatches" aria-label="Brand color palette"><span><i/>Deep navy</span><span><i/>Signal cyan</span><span><i/>Response blue</span></div></div>
   <Image src="/floodguard-brand.png" width={1536} height={1024} alt="FloodGuard logo with dam, connected water drop and the words Monitor, Predict, Protect" priority/>
  </section>
  <section className="about-grid"><article><BookOpen/><h2>Purpose</h2><p>FloodGuard explores how affordable sensors and transparent decision logic can improve situational awareness around flood-prone reservoirs.</p></article><article><Activity/><h2>Principle</h2><p>Show real measurements honestly, explain what they mean, and distinguish missing information from safe conditions.</p></article><article><ShieldCheck/><h2>Response</h2><p>Local Arduino logic can warn nearby people and move a prototype gate even when the website is only observing.</p></article><article><Users/><h2>Audience</h2><p>Communities, students, educators and evaluators can understand the system without needing embedded-systems expertise.</p></article></section>
  <section className="explain"><HeartHandshake/><div><h2>Prototype scope</h2><p>This is an educational prototype, not a certified public warning or dam-control product. Safety-critical deployment requires professional engineering, redundant sensing, secure control paths and authority approval.</p></div></section><CTA/>
 </main>
}
