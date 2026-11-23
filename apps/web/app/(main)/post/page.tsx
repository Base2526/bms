'use client';;
import { use } from "react";
import { useQuery, gql } from "@apollo/client";
import { Descriptions, Card } from "antd";

const Q = gql`query($id:ID!){ post(id:$id){ id title detail status author{ id name avatar } } }`;

function PostPage({ id }:{id:string}){
  const { data } = useQuery(Q,{ variables:{ id } });
  const p = data?.post;
  if (!p) return <div>Loading...</div>;
  return  <Card title={p.title}>
            <Descriptions bordered column={1}>
              <Descriptions.Item label="Phone">{p.phone}</Descriptions.Item>
              <Descriptions.Item label="Status">{p.status}</Descriptions.Item>
              <Descriptions.Item label="Author"><a href={`/profile/${p.author?.id}`}>{p.author?.name}</a></Descriptions.Item>
              <Descriptions.Item label="Body">{p.detail}</Descriptions.Item>
            </Descriptions>
          </Card>;
}

export default function Page(props:{ params: Promise<{ id:string }>}) {
  const params = use(props.params);
  return <PostPage id={params.id}/>;
}
