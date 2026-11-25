// The production icon, as GitHub shows the Murmur app, whatever this build's channel.
import appIconUrl from "../../../../assets/murmur/prod/apple-touch-180.png";

export function T3AppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
